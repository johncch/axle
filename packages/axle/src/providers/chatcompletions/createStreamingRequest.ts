import { AnyStreamChunk } from "../../messages/stream.js";
import { redactResolvedFileValues } from "../../utils/redact.js";
import { ProviderClientOptions, ProviderStreamParams } from "../types.js";
import { createStreamingAdapter } from "./createStreamingAdapter.js";
import { withRetry } from "./retry.js";
import { ChatCompletionChunk, ChatCompletionStreamError } from "./types.js";
import {
  convertAxleMessages,
  convertTools,
  prepareProviderTools,
  toChatCompletionsToolChoice,
  toReasoningEffort,
  type ChatCompletionsProviderToolVendor,
} from "./utils.js";

export async function* createStreamingRequest(
  params: ProviderStreamParams &
    ProviderClientOptions & {
      baseUrl: string;
      model: string;
      apiKey?: string;
      providerToolVendor?: ChatCompletionsProviderToolVendor;
    },
): AsyncGenerator<AnyStreamChunk, void, unknown> {
  const {
    baseUrl,
    model,
    messages,
    system,
    tools,
    providerTools,
    runtime,
    signal,
    apiKey,
    providerToolVendor,
    maxRetries,
    timeoutMs,
    reasoning,
    maxOutputTokens,
    temperature,
    topP,
    stop,
    toolChoice,
    parallelToolCalls,
    providerOptions,
  } = params;
  const tracer = runtime?.tracer;

  const adapter = createStreamingAdapter();

  try {
    const chatMessages = await convertAxleMessages(messages, system, {
      model,
      fileResolver: runtime?.fileResolver,
      signal,
    });
    const chatTools = convertTools(tools);
    const chatProviderTools = prepareProviderTools(
      providerTools,
      providerToolVendor,
      tracer?.warn.bind(tracer),
    );
    const requestTools = [...(chatTools ?? []), ...(chatProviderTools ?? [])];

    const requestBody: Record<string, any> = {
      model,
      messages: chatMessages,
      stream: true,
      stream_options: { include_usage: true },

      // Axle-normalized options.
      ...(requestTools.length > 0 ? { tools: requestTools } : {}),
      ...toReasoningEffort(reasoning),
      ...(maxOutputTokens !== undefined ? { max_tokens: maxOutputTokens } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { top_p: topP } : {}),
      ...(stop !== undefined ? { stop } : {}),
      ...toChatCompletionsToolChoice(toolChoice, tools, providerTools),
      ...(parallelToolCalls !== undefined ? { parallel_tool_calls: parallelToolCalls } : {}),

      // Raw provider options are applied last so they can override Axle mappings.
      ...providerOptions,
    };

    tracer?.debug("ChatCompletions streaming request", {
      request: redactResolvedFileValues(requestBody),
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await withRetry(
      ({ signal }) =>
        fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
          signal,
        }),
      {
        maxRetries,
        timeoutMs,
        signal,
        onRetry: (info) =>
          tracer?.debug("ChatCompletions streaming request retry", {
            attempt: info.attempt,
            maxRetries,
            timeoutMs,
            delayMs: info.delayMs,
            status: info.status,
            error: info.error instanceof Error ? info.error.message : undefined,
          }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `HTTP error! status: ${response.status}${errorText ? ` - ${errorText}` : ""}`,
      );
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;

        if (!trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;

        let chunk: ChatCompletionChunk;
        try {
          chunk = JSON.parse(data);
        } catch (e) {
          tracer?.error("Error parsing ChatCompletions stream chunk", {
            error: e instanceof Error ? e.message : String(e),
            line: trimmed,
          });
          continue;
        }

        if (chunk.error) {
          const upstreamError = normalizeStreamError(chunk.error);
          yield {
            type: "error",
            data: {
              type: upstreamError.type,
              message: upstreamError.message,
              raw: chunk.error,
            },
          };
          return;
        }

        const streamChunks = adapter.handleChunk(chunk);
        for (const streamChunk of streamChunks) {
          yield streamChunk;
        }
      }
    }

    // Emit deferred complete event (waits for usage-only chunk after finish_reason)
    for (const streamChunk of adapter.finalize()) {
      yield streamChunk;
    }
  } catch (error) {
    if (signal?.aborted) return;
    tracer?.error("Error in ChatCompletions streaming request", {
      error: error instanceof Error ? error.message : String(error),
    });
    yield {
      type: "error",
      data: {
        type: "STREAMING_ERROR",
        message: error instanceof Error ? error.message : String(error),
        raw: error,
      },
    };
  }
}

function normalizeStreamError(error: ChatCompletionStreamError | string): {
  type: string;
  message: string;
} {
  if (typeof error === "string") {
    return { type: "UPSTREAM_STREAM_ERROR", message: error };
  }

  const type =
    error.type ??
    (error.code === undefined ? undefined : String(error.code)) ??
    "UPSTREAM_STREAM_ERROR";

  return {
    type,
    message: error.message ?? type,
  };
}
