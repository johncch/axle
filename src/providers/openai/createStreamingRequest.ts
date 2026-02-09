import OpenAI from "openai";
import { AnyStreamChunk } from "../../messages/streaming/types.js";
import { AxleMessage } from "../../messages/types.js";
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

  const modelTools = prepareTools(tools);
  const request = {
    model,
    input: convertAxleMessageToResponseInput(messages),
    ...(system && { instructions: system }),
    stream: true as const,
    ...(modelTools ? { tools: modelTools } : {}),
    ...options,
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
