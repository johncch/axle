import OpenAI from "openai";
import { AnyStreamChunk } from "../../messages/stream.js";
import { redactResolvedFileValues } from "../../utils/redact.js";
import { ProviderStreamParams } from "../types.js";
import { normalizeProviderError } from "../utils.js";
import { createStreamingAdapter } from "./createStreamingAdapter.js";
import {
  convertAxleMessageToResponseInput,
  prepareProviderTools,
  prepareTools,
  toOpenAIInclude,
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
    toolChoice,
    parallelToolCalls,
    providerOptions,
  } = params;
  const span = runtime?.span;

  try {
    const modelTools: any[] = [
      ...(prepareTools(tools) ?? []),
      ...(prepareProviderTools(providerTools) ?? []),
    ];
    const include = toOpenAIInclude(providerTools);

    const streamingAdapter = createStreamingAdapter();

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
      ...(include.length > 0 ? { include } : {}),
      ...toOpenAIReasoning(reasoning),
      ...(maxOutputTokens !== undefined ? { max_output_tokens: maxOutputTokens } : {}),
      ...toOpenAIToolChoice(toolChoice, tools, providerTools),
      ...(parallelToolCalls !== undefined ? { parallel_tool_calls: parallelToolCalls } : {}),

      // Raw provider options are applied last so they can override Axle mappings.
      ...providerOptions,
    };

    span?.debug("OpenAI ResponsesAPI streaming request", {
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
    span?.error(error instanceof Error ? error.message : String(error));
    yield {
      type: "error",
      data: normalizeProviderError(error),
    };
  }
}
