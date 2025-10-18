import OpenAI from "openai";
import { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses.js";
import z from "zod";
import { Chat } from "../../messages/chat.js";
import { AxleMessage } from "../../messages/types.js";
import { Recorder } from "../../recorder/recorder.js";
import { ToolDef } from "../../tools/types.js";
import { AIProvider, AIRequest, AIResponse } from "../types.js";
import { OpenAIChatCompletionRequest, translateResponse as translateChatCompletionResponse } from "./chatCompletion.js";
import { Models, RESPONSES_API_MODELS } from "./models.js";
import { OpenAIResponsesAPI, translateResponseToAIResponse as translateResponsesAPIResponse } from "./responsesAPI.js";
import { convertAxleMessagesToChatCompletion } from "./utils/chatCompletion.js";
import { convertAxleMessageToResponseInput } from "./utils/responsesAPI.js";

const DEFAULT_MODEL = Models.GPT_4_1;

export class OpenAIProvider implements AIProvider {
  name = "OpenAI";
  client: OpenAI;
  model: string;

  constructor(apiKey: string, model?: string | undefined) {
    this.model = model || DEFAULT_MODEL;
    this.client = new OpenAI({ apiKey: apiKey });
  }

  createChatRequest(chat: Chat, context: { recorder?: Recorder } = {}): AIRequest {
    const { recorder } = context;
    // TODO: We don't have enough information to check for multimodal support yet
    if ((RESPONSES_API_MODELS as readonly string[]).includes(this.model)) {
      return new OpenAIResponsesAPI(this, chat);
    }
    return new OpenAIChatCompletionRequest(this, chat);
  }

  async createGenerationRequest(params: {
    messages: Array<AxleMessage>;
    tools?: Array<ToolDef>;
    context: { recorder?: Recorder };
  }): Promise<AIResponse> {
    const useResponsesAPI = (RESPONSES_API_MODELS as readonly string[]).includes(this.model);

    if (useResponsesAPI) {
      return await createGenerationRequestWithResponsesAPI({
        client: this.client,
        model: this.model,
        ...params,
      });
    } else {
      return await createGenerationRequestWithChatCompletion({
        client: this.client,
        model: this.model,
        ...params,
      });
    }
  }

  // createStreamingRequest(params: {
  //   messages: Array<AxleMessage>;
  //   tools?: Array<ToolDef>;
  //   context: { recorder?: Recorder };
  // }): AsyncGenerator<AnyStreamChunk, void, unknown> {
  //   // TODO
  // }
}

async function createGenerationRequestWithResponsesAPI(params: {
  client: OpenAI;
  model: string;
  messages: Array<AxleMessage>;
  tools?: Array<ToolDef>;
  context: { recorder?: Recorder };
}): Promise<AIResponse> {
  const { client, model, messages, tools, context } = params;
  const { recorder } = context;

  const request: ResponseCreateParamsNonStreaming = {
    model,
    input: convertAxleMessageToResponseInput(messages),
  };

  if (tools && tools.length > 0) {
    request.tools = tools.map((tool) => {
      const jsonSchema = z.toJSONSchema(tool.schema);
      return {
        type: "function" as const,
        strict: true,
        name: tool.name,
        description: tool.description,
        parameters: jsonSchema,
      };
    });
  }

  recorder?.debug?.log(request);

  let result: AIResponse;
  try {
    const response = await client.responses.create(request);
    result = translateResponsesAPIResponse(response);
  } catch (e) {
    recorder?.error?.log(e);
    result = {
      type: "error",
      error: {
        type: e.type ?? "Undetermined",
        message: e.message ?? "Unexpected error from OpenAI",
      },
      usage: { in: 0, out: 0 },
      raw: e,
    };
  }

  recorder?.debug?.log(result);
  return result;
}

async function createGenerationRequestWithChatCompletion(params: {
  client: OpenAI;
  model: string;
  messages: Array<AxleMessage>;
  tools?: Array<ToolDef>;
  context: { recorder?: Recorder };
}): Promise<AIResponse> {
  const { client, model, messages, tools, context } = params;
  const { recorder } = context;

  let chatTools = undefined;
  if (tools && tools.length > 0) {
    chatTools = tools.map((tool) => {
      const jsonSchema = z.toJSONSchema(tool.schema);
      return {
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: jsonSchema,
        },
      };
    });
  }

  const request = {
    model,
    messages: convertAxleMessagesToChatCompletion(messages),
    ...(chatTools && { tools: chatTools }),
  };

  recorder?.debug?.log(request);

  let result: AIResponse;
  try {
    const completion = await client.chat.completions.create(request);
    result = translateChatCompletionResponse(completion);
  } catch (e) {
    recorder?.error?.log(e);
    result = {
      type: "error",
      error: {
        type: e.type ?? "Undetermined",
        message: e.message ?? "Unexpected error from OpenAI",
      },
      usage: { in: 0, out: 0 },
      raw: e,
    };
  }

  recorder?.debug?.log(result);
  return result;
}
