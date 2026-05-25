import { GoogleGenAI } from "@google/genai";
import { AnyStreamChunk } from "../../messages/stream.js";
import { redactResolvedFileValues } from "../../utils/redact.js";
import { ProviderStreamParams } from "../types.js";
import { createGeminiStreamingAdapter } from "./createStreamingAdapter.js";
import {
  addGeminiProviderTools,
  convertAxleMessagesToGemini,
  prepareConfig,
  toGeminiThinkingConfig,
  toGeminiToolConfig,
} from "./utils.js";

export async function* createStreamingRequest(
  params: ProviderStreamParams & { client: GoogleGenAI; model: string },
): AsyncGenerator<AnyStreamChunk, void, unknown> {
  const {
    client,
    model,
    messages,
    system,
    tools,
    providerTools,
    runtime,
    signal,
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

  const googleOptions: Record<string, any> = {
    // Axle-normalized options.
    ...toGeminiThinkingConfig(reasoning),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { topP } : {}),
    ...(stop !== undefined ? { stopSequences: Array.isArray(stop) ? stop : [stop] } : {}),
    ...toGeminiToolConfig(toolChoice, parallelToolCalls, tools, providerTools),

    // Raw provider options are applied last so they can override Axle mappings.
    ...providerOptions,
  };

  const config = prepareConfig(tools, system, googleOptions);
  if (toolChoice !== "none") {
    addGeminiProviderTools(config, providerTools);
  }

  const streamingAdapter = createGeminiStreamingAdapter();

  try {
    const contents = await convertAxleMessagesToGemini(messages, {
      model,
      fileResolver: runtime?.fileResolver,
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
