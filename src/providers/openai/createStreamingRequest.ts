import OpenAI from "openai";
import { AnyStreamChunk } from "../../messages/stream.js";
import { redactResolvedFileValues } from "../../utils/redact.js";
import { StreamingRequestParams } from "../types.js";
import { createStreamingAdapter } from "./createStreamingAdapter.js";
import { convertAxleMessageToResponseInput, prepareTools, toOpenAIReasoning } from "./utils.js";

export async function* createStreamingRequest(
  params: StreamingRequestParams & { client: OpenAI; model: string },
): AsyncGenerator<AnyStreamChunk, void, unknown> {
  const { client, model, messages, system, tools, context, signal, options, reasoning } = params;
  const tracer = context?.tracer;

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

  const streamingAdapter = createStreamingAdapter();

  try {
    const input = await convertAxleMessageToResponseInput(messages, {
      model,
      fileResolver: context?.fileResolver,
      signal,
    });

    const request = {
      model,
      input,
      ...(system && { instructions: system }),
      stream: true as const,
      ...(modelTools.length > 0 ? { tools: modelTools } : {}),
      ...toOpenAIReasoning(reasoning),
      ...restOptions,
    };

    tracer?.debug("OpenAI ResponsesAPI streaming request", {
      request: redactResolvedFileValues(request),
    });

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
