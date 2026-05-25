import Anthropic from "@anthropic-ai/sdk";
import { AnyStreamChunk } from "../../messages/stream.js";
import { redactResolvedFileValues } from "../../utils/redact.js";
import { arrayify } from "../../utils/utils.js";
import { ProviderStreamParams } from "../types.js";
import { createAnthropicStreamingAdapter } from "./createStreamingAdapter.js";
import { MAX_OUTPUT_TOKENS } from "./models.js";
import {
  convertToAnthropicProviderTools,
  convertToAnthropicTools,
  convertToProviderMessages,
  toAnthropicThinking,
  toAnthropicToolChoice,
} from "./utils.js";

export async function* createStreamingRequest(
  params: ProviderStreamParams & { client: Anthropic; model: string },
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

  const apiTools: any[] = [
    ...(tools ? convertToAnthropicTools(tools) : []),
    ...convertToAnthropicProviderTools(providerTools),
  ];

  const streamingAdapter = createAnthropicStreamingAdapter();

  try {
    const providerMessages = await convertToProviderMessages(messages, {
      model,
      fileResolver: runtime?.fileResolver,
      signal,
    });

    const request = {
      model: model,
      max_tokens: maxOutputTokens ?? getMaxTokens(model),
      messages: providerMessages,
      ...(system && { system }),

      // Axle-normalized options.
      ...(stop && { stop_sequences: arrayify(stop) }),
      ...(apiTools.length > 0 && { tools: apiTools }),
      ...toAnthropicThinking(reasoning),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { top_p: topP } : {}),
      ...toAnthropicToolChoice(toolChoice, parallelToolCalls, tools, providerTools),

      // Raw provider options are applied last so they can override Axle mappings.
      ...providerOptions,
    };
    tracer?.debug("Anthropic streaming request", { request: redactResolvedFileValues(request) });

    const stream = await client.messages.create(
      {
        ...request,
        stream: true as const,
      },
      { signal },
    );

    for await (const messageStreamEvent of stream) {
      const chunks = streamingAdapter.handleEvent(messageStreamEvent);
      for (const chunk of chunks) {
        yield chunk;
      }
    }
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

export function getMaxTokens(model: string): number {
  if (model in MAX_OUTPUT_TOKENS) return MAX_OUTPUT_TOKENS[model];

  if (model.includes("opus")) {
    // Opus 4.6+ trend: 128K
    if (model.match(/opus-4-[6-9]|opus-[5-9]/)) return 128000;
    return 64000;
  }

  if (model.includes("sonnet") || model.includes("haiku")) {
    if (model.match(/claude-3-[0-5]-/)) return 8192;
    return 64000;
  }

  return 16384;
}
