import { AxleMessage } from "../../messages/message.js";
import { AnyStreamChunk } from "../../messages/stream.js";
import { ToolDefinition } from "../../tools/types.js";
import type { TracingContext } from "../../tracer/types.js";
import { createStreamingAdapter } from "./createStreamingAdapter.js";
import { ChatCompletionChunk } from "./types.js";
import { convertAxleMessages, convertTools } from "./utils.js";

export async function* createStreamingRequest(params: {
  baseUrl: string;
  model: string;
  messages: Array<AxleMessage>;
  system?: string;
  tools?: Array<ToolDefinition>;
  context: { tracer?: TracingContext };
  signal?: AbortSignal;
  apiKey?: string;
  options?: {
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    stop?: string | string[];
    [key: string]: any;
  };
}): AsyncGenerator<AnyStreamChunk, void, unknown> {
  const { baseUrl, model, messages, system, tools, context, signal, apiKey, options } = params;
  const tracer = context?.tracer;

  const chatMessages = convertAxleMessages(messages, system);
  const chatTools = convertTools(tools);

  const requestBody: Record<string, any> = {
    model,
    messages: chatMessages,
    stream: true,
    stream_options: { include_usage: true },
    ...(chatTools && { tools: chatTools }),
  };

  if (options) {
    if (options.temperature !== undefined) requestBody.temperature = options.temperature;
    if (options.top_p !== undefined) requestBody.top_p = options.top_p;
    if (options.max_tokens !== undefined) requestBody.max_tokens = options.max_tokens;
    if (options.frequency_penalty !== undefined)
      requestBody.frequency_penalty = options.frequency_penalty;
    if (options.presence_penalty !== undefined)
      requestBody.presence_penalty = options.presence_penalty;
    if (options.stop !== undefined) requestBody.stop = options.stop;
  }

  tracer?.debug("ChatCompletions streaming request", { request: requestBody });

  const adapter = createStreamingAdapter();

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal,
    });

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

        try {
          const chunk: ChatCompletionChunk = JSON.parse(data);
          const streamChunks = adapter.handleChunk(chunk);
          for (const streamChunk of streamChunks) {
            yield streamChunk;
          }
        } catch (e) {
          tracer?.error("Error parsing ChatCompletions stream chunk", {
            error: e instanceof Error ? e.message : String(e),
            line: trimmed,
          });
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
