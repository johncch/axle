import OpenAI from "openai";
import { AxleMessage } from "../../messages/message.js";
import { AnyStreamChunk } from "../../messages/stream.js";
import { ToolDefinition } from "../../tools/types.js";
import type { TracingContext } from "../../tracer/types.js";
import { createStreamingAdapter } from "./createStreamingAdapter.js";
import { convertAxleMessageToResponseInput, prepareTools } from "./utils.js";

export async function* createStreamingRequest(params: {
  client: OpenAI;
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

  const { serverTools, ...restOptions } = options ?? {};

  const modelTools: any[] = prepareTools(tools) ?? [];

  if (serverTools) {
    const OPENAI_SERVER_TOOL_MAP: Record<string, string> = {
      web_search: "web_search_preview",
      code_execution: "code_interpreter",
    };
    for (const st of serverTools) {
      const mappedType = OPENAI_SERVER_TOOL_MAP[st.name] ?? st.name;
      modelTools.push({ type: mappedType, ...st.config });
    }
  }

  const request = {
    model,
    input: convertAxleMessageToResponseInput(messages),
    ...(system && { instructions: system }),
    stream: true as const,
    ...(modelTools.length > 0 ? { tools: modelTools } : {}),
    ...restOptions,
  };

  tracer?.debug("OpenAI ResponsesAPI streaming request", { request });

  const streamingAdapter = createStreamingAdapter();

  try {
    const stream = client.responses.stream(request, ...(signal ? [{ signal }] : []));

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
