import OpenAI from "openai";
import { AnyStreamChunk } from "../../messages/streaming/types.js";
import { AxleMessage } from "../../messages/types.js";
import { Recorder } from "../../recorder/recorder.js";
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
  tools?: Array<ToolDefinition>;
  runtime: { recorder?: Recorder };
}): AsyncGenerator<AnyStreamChunk, void, unknown> {
  const { client, model, messages, tools, runtime } = params;
  const { recorder } = runtime;

  const useResponsesAPI = (RESPONSES_API_MODELS as readonly string[]).includes(model);

  if (useResponsesAPI) {
    yield* createResponsesAPIStream({ client, model, messages, tools, runtime });
  } else {
    yield* createChatCompletionStream({ client, model, messages, tools, runtime });
  }
}

async function* createChatCompletionStream(params: {
  client: OpenAI;
  model: string;
  messages: Array<AxleMessage>;
  tools?: Array<ToolDefinition>;
  runtime: { recorder?: Recorder };
}): AsyncGenerator<AnyStreamChunk, void, unknown> {
  const { client, model, messages, tools, runtime } = params;
  const { recorder } = runtime;

  const chatTools = toModelTools(tools);
  const request = {
    model,
    messages: convertAxleMessagesToChatCompletion(messages),
    ...(chatTools && { tools: chatTools }),
    stream: true as const,
  };

  recorder?.debug?.log(request);

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
    recorder?.error?.log(error);
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
  tools?: Array<ToolDefinition>;
  runtime: { recorder?: Recorder };
}): AsyncGenerator<AnyStreamChunk, void, unknown> {
  const { client, model, messages, tools, runtime } = params;
  const { recorder } = runtime;

  const modelTools = prepareTools(tools);
  const request = {
    model,
    input: convertAxleMessageToResponseInput(messages),
    stream: true as const,
    ...(modelTools ? { tools: modelTools } : {}),
  };

  recorder?.debug?.log(request);

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
    recorder?.error?.log(error);
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
