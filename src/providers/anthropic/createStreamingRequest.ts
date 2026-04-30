import Anthropic from "@anthropic-ai/sdk";
import { AnyStreamChunk } from "../../messages/stream.js";
import { redactResolvedFileValues } from "../../utils/redact.js";
import { arrayify } from "../../utils/utils.js";
import { StreamingRequestParams } from "../types.js";
import { createAnthropicStreamingAdapter } from "./createStreamingAdapter.js";
import { MAX_OUTPUT_TOKENS } from "./models.js";
import { convertToProviderMessages, convertToProviderTools } from "./utils.js";

export async function* createStreamingRequest(
  params: StreamingRequestParams & { client: Anthropic; model: string },
): AsyncGenerator<AnyStreamChunk, void, unknown> {
  const { client, model, messages, system, tools, context, signal, options } = params;
  const tracer = context?.tracer;

  const { stop, max_tokens, serverTools, ...restOptions } = options ?? {};

  const providerTools: any[] = tools ? convertToProviderTools(tools) : [];

  if (serverTools) {
    const ANTHROPIC_SERVER_TOOL_MAP: Record<string, string> = {
      web_search: "web_search_20250305",
    };
    for (const st of serverTools) {
      const mappedType = ANTHROPIC_SERVER_TOOL_MAP[st.name] ?? st.name;
      providerTools.push({ type: mappedType, name: st.name, ...st.config });
    }
  }

  const streamingAdapter = createAnthropicStreamingAdapter();

  try {
    const providerMessages = await convertToProviderMessages(messages, {
      model,
      fileResolver: context?.fileResolver,
      signal,
    });

    const request = {
      model: model,
      max_tokens: max_tokens ?? getMaxTokens(model),
      messages: providerMessages,
      ...(system && { system }),
      ...(stop && { stop_sequences: arrayify(stop) }),
      ...(providerTools.length > 0 && { tools: providerTools }),
      ...restOptions,
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
