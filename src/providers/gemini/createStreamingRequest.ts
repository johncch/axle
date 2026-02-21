import { GoogleGenAI } from "@google/genai";
import { AxleMessage } from "../../messages/message.js";
import { AnyStreamChunk } from "../../messages/stream.js";
import { ToolDefinition } from "../../tools/types.js";
import type { TracingContext } from "../../tracer/types.js";
import { createGeminiStreamingAdapter } from "./createStreamingAdapter.js";
import { convertAxleMessagesToGemini, prepareConfig } from "./utils.js";

export async function* createStreamingRequest(params: {
  client: GoogleGenAI;
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

  // Extract serverTools before option conversion
  const { serverTools, ...rawOptions } = options ?? {};

  // Convert max_tokens to maxOutputTokens for Google AI
  const googleOptions = rawOptions ? { ...rawOptions } : {};
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

  const config = prepareConfig(tools, system, googleOptions);

  if (serverTools) {
    const GEMINI_SERVER_TOOL_MAP: Record<string, string> = {
      web_search: "googleSearch",
      code_execution: "codeExecution",
    };
    if (!config.tools) config.tools = [];
    for (const st of serverTools) {
      const key = GEMINI_SERVER_TOOL_MAP[st.name] ?? st.name;
      config.tools.push({ [key]: st.config ?? {} } as any);
    }
  }

  const request = {
    contents: convertAxleMessagesToGemini(messages),
    config,
  };
  tracer?.debug("Gemini streaming request", { request });

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
    if (signal?.aborted) return;
    tracer?.error(error instanceof Error ? error.message : String(error));
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
