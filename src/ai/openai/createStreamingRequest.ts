import OpenAI from "openai";
import { AnyStreamChunk } from "../../messages/streaming/types.js";
import { AxleMessage } from "../../messages/types.js";
import type { TracingContext } from "../../tracer/types.js";
import { ToolDefinition } from "../../tools/types.js";
import { createChatCompletionStreamingAdapter } from "./createChatCompletionStreamingAdapter.js";
import { createResponsesAPIStreamingAdapter } from "./createResponsesAPIStreamingAdapter.js";
import { RESPONSES_API_MODELS } from "./models.js";
import { convertAxleMessagesToChatCompletion, toModelTools } from "./utils/chatCompletion.js";
import { convertAxleMessageToResponseInput, prepareTools } from "./utils/responsesAPI.js";

export async function* createStreamingRequest(params: {
  client: OpenAI;
  model: string;
  messages: Array<AxleMessage>;
  system?: string;
  tools?: Array<ToolDefinition>;
  runtime: { tracer?: TracingContext };
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
  const { client, model, messages, system, tools, runtime, options } = params;
  const tracer = runtime?.tracer;

  const useResponsesAPI = (RESPONSES_API_MODELS as readonly string[]).includes(model);

  if (useResponsesAPI) {
    yield* createResponsesAPIStream({ client, model, messages, system, tools, runtime, options });
  } else {
    yield* createChatCompletionStream({ client, model, messages, system, tools, runtime, options });
  }
}

async function* createChatCompletionStream(params: {
  client: OpenAI;
  model: string;
  messages: Array<AxleMessage>;
  system?: string;
  tools?: Array<ToolDefinition>;
  runtime: { tracer?: TracingContext };
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
  const { client, model, messages, system, tools, runtime, options } = params;
  const tracer = runtime?.tracer;

  const chatTools = toModelTools(tools);
  const request = {
    model,
    messages: convertAxleMessagesToChatCompletion(messages, system),
    ...(chatTools && { tools: chatTools }),
    ...options,
    stream: true as const,
  };

  tracer?.debug("OpenAI ChatCompletion streaming request", { request });

  const streamingAdapter = createChatCompletionStreamingAdapter();

  try {
    const stream = await client.chat.completions.create(request);

    for await (const chunk of stream) {
      const chunks = streamingAdapter.handleChunk(chunk);
      for (const streamChunk of chunks) {
        yield streamChunk;
      }
    }
  } catch (error) {
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

async function* createResponsesAPIStream(params: {
  client: OpenAI;
  model: string;
  messages: Array<AxleMessage>;
  system?: string;
  tools?: Array<ToolDefinition>;
  runtime: { tracer?: TracingContext };
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
  const { client, model, messages, system, tools, runtime, options } = params;
  const tracer = runtime?.tracer;

  console.log(options);

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

  const streamingAdapter = createResponsesAPIStreamingAdapter();

  try {
    const stream = client.responses.stream(request);

    for await (const event of stream) {
      const chunks = streamingAdapter.handleEvent(event);
      for (const streamChunk of chunks) {
        yield streamChunk;
      }
    }
  } catch (error) {
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
