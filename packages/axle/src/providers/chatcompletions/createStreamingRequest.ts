import { AnyStreamChunk } from "../../messages/stream.js";
import type { ToolDefinition } from "../../tools/types.js";
import { redactResolvedFileValues } from "../../utils/redact.js";
import { ProviderClientOptions, ProviderStreamParams } from "../types.js";
import { normalizeProviderError } from "../utils.js";
import { createStreamingAdapter } from "./createStreamingAdapter.js";
import { withRetry } from "./retry.js";
import { ChatCompletionChunk, ChatCompletionStreamError } from "./types.js";
import {
  convertAxleMessages,
  convertTools,
  prepareProviderTools,
  toChatCompletionsReasoning,
  toChatCompletionsToolChoice,
  type ChatCompletionsVendor,
} from "./utils.js";

export async function* createStreamingRequest(
  params: ProviderStreamParams &
    ProviderClientOptions & {
      baseUrl: string;
      model: string;
      apiKey?: string;
      vendor?: ChatCompletionsVendor;
      webSearchTool?: ToolDefinition;
    },
): AsyncGenerator<AnyStreamChunk, void, unknown> {
  const {
    baseUrl,
    model,
    messages,
    system,
    sessionId,
    runtime,
    signal,
    apiKey,
    vendor,
    webSearchTool,
    maxRetries,
    timeoutMs,
    headers: clientHeaders,
    reasoning,
    maxOutputTokens,
    toolChoice,
    parallelToolCalls,
    providerOptions,
  } = params;
  const span = runtime?.span;
  const usesAttachedSearch =
    webSearchTool !== undefined && params.providerTools?.some((tool) => tool.name === "web_search");
  const tools = usesAttachedSearch ? [...(params.tools ?? []), webSearchTool] : params.tools;
  const providerTools = usesAttachedSearch
    ? params.providerTools?.filter((tool) => tool.name !== "web_search")
    : params.providerTools;

  const adapter = createStreamingAdapter();

  try {
    const chatMessages = await convertAxleMessages(messages, system, {
      model,
      vendor,
      fileResolver: runtime?.fileResolver,
      signal,
      warn: span?.warn.bind(span),
    });
    const chatTools = convertTools(tools);
    const chatProviderTools = prepareProviderTools(providerTools, vendor, span?.warn.bind(span));
    const requestTools = [...(chatTools ?? []), ...(chatProviderTools ?? [])];

    const requestBody: Record<string, any> = {
      model,
      messages: chatMessages,
      stream: true,
      stream_options: { include_usage: true },

      // Axle-normalized options.
      ...(requestTools.length > 0 ? { tools: requestTools } : {}),
      ...toChatCompletionsReasoning(reasoning, vendor),
      ...(maxOutputTokens !== undefined ? { max_tokens: maxOutputTokens } : {}),
      ...toChatCompletionsToolChoice(toolChoice, tools, providerTools),
      ...(parallelToolCalls !== undefined ? { parallel_tool_calls: parallelToolCalls } : {}),
      ...(vendor === "openrouter" && sessionId !== undefined ? { session_id: sessionId } : {}),

      // Raw provider options are applied last so they can override Axle mappings.
      ...providerOptions,
    };

    span?.debug("ChatCompletions request", {
      model: requestBody.model,
      messages: requestBody.messages.length,
      tools: requestBody.tools?.length ?? 0,
      stream: true,
    });
    span?.trace("ChatCompletions request body", {
      request: redactResolvedFileValues(requestBody),
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...clientHeaders,
    };

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
          span?.warn("ChatCompletions streaming request retry", {
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
      throw describeHttpError(response.status, errorText);
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
          span?.error("Error parsing ChatCompletions stream chunk", {
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
    span?.error("Error in ChatCompletions streaming request", {
      error: error instanceof Error ? error.message : String(error),
    });
    yield {
      type: "error",
      data: normalizeProviderError(error),
    };
  }
}

function describeHttpError(
  status: number,
  text: string,
): { status: number; type: string; message: string; body: unknown } {
  const fallback = {
    status,
    type: String(status),
    message: `HTTP error! status: ${status}${text ? ` - ${text}` : ""}`,
    body: text,
  };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fallback;
  }
  const upstream =
    body && typeof body === "object" && "error" in body ? (body as { error: unknown }).error : null;
  if (!upstream || typeof upstream !== "object") return { ...fallback, body };
  const { type, code, message } = upstream as ChatCompletionStreamError;
  return {
    status,
    type: type ?? (code === undefined ? fallback.type : String(code)),
    message: message ?? fallback.message,
    body,
  };
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
