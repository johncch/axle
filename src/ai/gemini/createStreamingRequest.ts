import { GoogleGenAI } from "@google/genai";
import { AnyStreamChunk } from "../../messages/streaming/types.js";
import { AxleMessage } from "../../messages/types.js";
import { Recorder } from "../../recorder/recorder.js";
import { ToolDefinition } from "../../tools/types.js";
import { createGeminiStreamingAdapter } from "./createStreamingAdapter.js";
import { convertAxleMessagesToGemini, prepareConfig } from "./utils.js";

export async function* createStreamingRequest(params: {
  client: GoogleGenAI;
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

  // Convert max_tokens to maxOutputTokens for Google AI
  const googleOptions = options ? { ...options } : {};
  if (googleOptions.max_tokens) {
    googleOptions.maxOutputTokens = googleOptions.max_tokens;
    delete googleOptions.max_tokens;
  }
  // Convert stop to stopSequences for Google AI
  if (googleOptions.stop) {
    googleOptions.stopSequences = Array.isArray(googleOptions.stop)
      ? googleOptions.stop
      : [googleOptions.stop];
    delete googleOptions.stop;
  }
  // Convert top_p to topP for Google AI
  if (googleOptions.top_p !== undefined) {
    googleOptions.topP = googleOptions.top_p;
    delete googleOptions.top_p;
  }

  const request = {
    contents: convertAxleMessagesToGemini(messages),
    config: prepareConfig(tools, system, googleOptions),
  };
  recorder?.debug?.log(request);

  const streamingAdapter = createGeminiStreamingAdapter();

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
