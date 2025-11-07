import { GoogleGenAI } from "@google/genai";
import { AnyStreamChunk } from "../../messages/streaming/types.js";
import { AxleMessage } from "../../messages/types.js";
import { Recorder } from "../../recorder/recorder.js";
import { ToolDefinition } from "../../tools/types.js";
import { createGoogleAIStreamingAdapter } from "./createStreamingAdapter.js";
import { convertAxleMessagesToGoogleAI, prepareConfig } from "./utils.js";

export async function* createStreamingRequest(params: {
  client: GoogleGenAI;
  model: string;
  messages: Array<AxleMessage>;
  tools?: Array<ToolDefinition>;
  runtime: { recorder?: Recorder };
}): AsyncGenerator<AnyStreamChunk, void, unknown> {
  const { client, model, messages, tools, runtime } = params;
  const { recorder } = runtime;

  const request = {
    contents: convertAxleMessagesToGoogleAI(messages),
    config: prepareConfig(tools),
  };
  recorder?.debug?.log(request);

  const streamingAdapter = createGoogleAIStreamingAdapter();

  try {
    const stream = await client.models.generateContentStream({
      model,
      ...request,
    });

    for await (const chunk of stream) {
      const chunks = streamingAdapter.handleChunk(chunk);
      for (const streamChunk of chunks) {
        yield streamChunk;
      }
    }
  } catch (error) {
    recorder?.error?.log(error);
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
