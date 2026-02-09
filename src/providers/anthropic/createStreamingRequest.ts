import Anthropic from "@anthropic-ai/sdk";
import { AnyStreamChunk } from "../../messages/streaming/types.js";
import { AxleMessage } from "../../messages/types.js";
import type { TracingContext } from "../../tracer/types.js";
import { ToolDefinition } from "../../tools/types.js";
import { createAnthropicStreamingAdapter } from "./createStreamingAdapter.js";
import { convertToProviderMessages, convertToProviderTools } from "./utils.js";

export async function* createStreamingRequest(params: {
  client: Anthropic;
  model: string;
  messages: Array<AxleMessage>;
  system?: string;
  tools?: Array<ToolDefinition>;
  runtime: { tracer?: TracingContext };
  signal?: AbortSignal;
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
  const { client, model, messages, system, tools, runtime, signal, options } = params;
  const tracer = runtime?.tracer;

  // Convert stop to stop_sequences for Anthropic
  const anthropicOptions = options ? { ...options } : {};
  if (anthropicOptions.stop) {
    anthropicOptions.stop_sequences = Array.isArray(anthropicOptions.stop)
      ? anthropicOptions.stop
      : [anthropicOptions.stop];
    delete anthropicOptions.stop;
  }

  const request = {
    model: model,
    max_tokens: 4096,
    messages: convertToProviderMessages(messages),
    ...(system && { system }),
    ...(tools && { tools: convertToProviderTools(tools) }),
    ...anthropicOptions,
  };
  tracer?.debug("Anthropic streaming request", { request });

  const streamingAdapter = createAnthropicStreamingAdapter();

  try {
    const stream = await client.messages.create({
      ...request,
      stream: true as const,
    }, { signal });

    for await (const messageStreamEvent of stream) {
      const chunks = streamingAdapter.handleEvent(messageStreamEvent);
      for (const chunk of chunks) {
        yield chunk;
      }
    }
    // testStream.end();
  } catch (error) {
    if (signal?.aborted) return;
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
