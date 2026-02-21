import Anthropic from "@anthropic-ai/sdk";
import { AxleMessage } from "../../messages/message.js";
import { AnyStreamChunk } from "../../messages/stream.js";
import { ToolDefinition } from "../../tools/types.js";
import type { TracingContext } from "../../tracer/types.js";
import { arrayify } from "../../utils/utils.js";
import { createAnthropicStreamingAdapter } from "./createStreamingAdapter.js";
import { Models } from "./models.js";
import { convertToProviderMessages, convertToProviderTools } from "./utils.js";

export async function* createStreamingRequest(params: {
  client: Anthropic;
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

  const request = {
    model: model,
    max_tokens: max_tokens ?? getMaxTokens(model),
    messages: convertToProviderMessages(messages),
    ...(system && { system }),
    ...(stop && { stop_sequences: arrayify(stop) }),
    ...(providerTools.length > 0 && { tools: providerTools }),
    ...restOptions,
  };
  tracer?.debug("Anthropic streaming request", { request });

  const streamingAdapter = createAnthropicStreamingAdapter();

  try {
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
    // testStream.end();
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

const MAX_OUTPUT_TOKENS: Record<string, number> = {
  // 128K
  [Models.CLAUDE_OPUS_4_6]: 128000,
  // 64K
  [Models.CLAUDE_OPUS_4_5_20251101]: 64000,
  [Models.CLAUDE_HAIKU_4_5_20251001]: 64000,
  [Models.CLAUDE_SONNET_4_5_20250929]: 64000,
  [Models.CLAUDE_SONNET_4_20250514]: 64000,
  // 32K
  [Models.CLAUDE_OPUS_4_1_20250805]: 32000,
  [Models.CLAUDE_OPUS_4_20250514]: 32000,
  // 4K
  [Models.CLAUDE_3_HAIKU_20240307]: 4096,
};

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
