import OpenAI from "openai";
import { AnyStreamChunk } from "../../messages/stream.js";
import { redactResolvedFileValues } from "../../utils/redact.js";
import { ProviderStreamParams } from "../types.js";
import { createStreamingAdapter } from "./createStreamingAdapter.js";
import {
  convertAxleMessageToResponseInput,
  prepareProviderTools,
  prepareTools,
  toOpenAIReasoning,
  toOpenAIToolChoice,
} from "./utils.js";

export async function* createStreamingRequest(
  params: ProviderStreamParams & { client: OpenAI; model: string },
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

  if (stop !== undefined) {
    throw new Error("OpenAI Responses does not support normalized stop sequences");
  }

  const modelTools: any[] = [
    ...(prepareTools(tools) ?? []),
    ...(prepareProviderTools(providerTools) ?? []),
  ];

  const streamingAdapter = createStreamingAdapter();

  try {
    const input = await convertAxleMessageToResponseInput(messages, {
      model,
      fileResolver: runtime?.fileResolver,
      signal,
    });

    const request = {
      model,
      input,
      ...(system && { instructions: system }),
      stream: true as const,

      // Axle-normalized options.
      ...(modelTools.length > 0 ? { tools: modelTools } : {}),
      ...toOpenAIReasoning(reasoning),
      ...(maxOutputTokens !== undefined ? { max_output_tokens: maxOutputTokens } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { top_p: topP } : {}),
      ...toOpenAIToolChoice(toolChoice, tools, providerTools),
      ...(parallelToolCalls !== undefined ? { parallel_tool_calls: parallelToolCalls } : {}),

      // Raw provider options are applied last so they can override Axle mappings.
      ...providerOptions,
    };

    tracer?.debug("OpenAI ResponsesAPI streaming request", {
      request: redactResolvedFileValues(request),
    });

    const stream = client.responses.stream(request as any, ...(signal ? [{ signal }] : []));

    for await (const event of stream) {
      const chunks = streamingAdapter.handleEvent(event);
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
