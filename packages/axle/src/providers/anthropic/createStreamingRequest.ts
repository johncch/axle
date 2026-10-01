import Anthropic from "@anthropic-ai/sdk";
import { AnyStreamChunk } from "../../messages/stream.js";
import { redactResolvedFileValues } from "../../utils/redact.js";
import { ProviderStreamParams } from "../types.js";
import { normalizeProviderError } from "../utils.js";
import { createAnthropicStreamingAdapter } from "./createStreamingAdapter.js";
import {
  convertToAnthropicProviderTools,
  convertToAnthropicTools,
  convertToProviderMessages,
  getAnthropicStreamMaxTokens,
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
    toolChoice,
    parallelToolCalls,
    providerOptions,
  } = params;
  const span = runtime?.span;

  try {
    const apiTools: any[] = [
      ...(tools ? convertToAnthropicTools(tools) : []),
      ...convertToAnthropicProviderTools(providerTools),
    ];

    const streamingAdapter = createAnthropicStreamingAdapter();

    const providerMessages = await convertToProviderMessages(messages, {
      model,
      fileResolver: runtime?.fileResolver,
      signal,
    });

    const initialRequest = {
      model: model,
      max_tokens: maxOutputTokens ?? getAnthropicStreamMaxTokens(model),
      messages: providerMessages,
      ...(system && { system }),

      // Axle-normalized options.
      ...(apiTools.length > 0 && { tools: apiTools }),
      ...toAnthropicThinking(reasoning, model),
      ...toAnthropicToolChoice(toolChoice, parallelToolCalls, tools, providerTools),

      // Raw provider options are applied last so they can override Axle mappings.
      ...providerOptions,
    };

    let request = initialRequest;
    while (true) {
      span?.debug("Anthropic streaming request", { request: redactResolvedFileValues(request) });

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

      const pausedContent = streamingAdapter.pausedContent();
      if (!pausedContent || signal?.aborted) break;
      request = {
        ...initialRequest,
        messages: [...initialRequest.messages, { role: "assistant", content: pausedContent }],
      };
    }
  } catch (error) {
    if (signal?.aborted) return;
    yield {
      type: "error",
      data: normalizeProviderError(error),
    };
  }
}
