import { GoogleGenAI } from "@google/genai";
import { AnyStreamChunk } from "../../messages/stream.js";
import { redactResolvedFileValues } from "../../utils/redact.js";
import { StreamingRequestParams } from "../types.js";
import { createGeminiStreamingAdapter } from "./createStreamingAdapter.js";
import { convertAxleMessagesToGemini, prepareConfig, toGeminiThinkingConfig } from "./utils.js";

export async function* createStreamingRequest(
  params: StreamingRequestParams & { client: GoogleGenAI; model: string },
): AsyncGenerator<AnyStreamChunk, void, unknown> {
  const { client, model, messages, system, tools, context, signal, options, reasoning } = params;
  const tracer = context?.tracer;

  // Extract providerTools before option conversion
  const { providerTools, ...rawOptions } = options ?? {};

  // Reasoning translation comes first so user-supplied thinkingConfig overrides.
  const googleOptions: Record<string, any> = {
    ...toGeminiThinkingConfig(reasoning),
    ...rawOptions,
  };
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

  if (providerTools) {
    const GEMINI_PROVIDER_TOOL_MAP: Record<string, string> = {
      web_search: "googleSearch",
      code_execution: "codeExecution",
    };
    if (!config.tools) config.tools = [];
    for (const st of providerTools) {
      const key = GEMINI_PROVIDER_TOOL_MAP[st.name] ?? st.name;
      config.tools.push({ [key]: st.config ?? {} } as any);
    }
  }

  const streamingAdapter = createGeminiStreamingAdapter();

  try {
    const contents = await convertAxleMessagesToGemini(messages, {
      model,
      fileResolver: context?.fileResolver,
      signal,
    });

    const request = {
      contents,
      config,
    };
    tracer?.debug("Gemini streaming request", { request: redactResolvedFileValues(request) });

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
