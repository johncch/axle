import Anthropic from "@anthropic-ai/sdk";
import { AnyStreamChunk } from "../../messages/streaming/types.js";
import { AxleMessage } from "../../messages/types.js";
import { Recorder } from "../../recorder/recorder.js";
import { ToolDefinition } from "../../tools/types.js";
import { createAnthropicStreamingAdapter } from "./createStreamingAdapter.js";
import { convertToProviderMessages, convertToProviderTools } from "./utils.js";

export async function* createStreamingRequest(params: {
  client: Anthropic;
  model: string;
  messages: Array<AxleMessage>;
  system?: string;
  tools?: Array<ToolDefinition>;
  runtime: { recorder?: Recorder };
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
  const { client, model, messages, system, tools, runtime, options } = params;
  const { recorder } = runtime;

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
  recorder?.debug?.log(request);

  const streamingAdapter = createAnthropicStreamingAdapter();

  try {
    const stream = await client.messages.create({
      ...request,
      stream: true as const,
    });

    for await (const messageStreamEvent of stream) {
      const chunks = streamingAdapter.handleEvent(messageStreamEvent);
      for (const chunk of chunks) {
        yield chunk;
      }
    }
    // testStream.end();
  } catch (error) {
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
