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
  tools?: Array<ToolDefinition>;
  runtime: { recorder?: Recorder };
}): AsyncGenerator<AnyStreamChunk, void, unknown> {
  const { client, model, messages, tools, runtime } = params;
  const { recorder } = runtime;

  const request = {
    model: model,
    max_tokens: 4096,
    messages: convertToProviderMessages(messages),
    ...(tools && { tools: convertToProviderTools(tools) }),
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
        error: error instanceof Error ? error.message : String(error),
        code: "STREAMING_ERROR",
      },
    };
  }
}
