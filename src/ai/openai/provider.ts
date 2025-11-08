import OpenAI from "openai";
import { AnyStreamChunk } from "../../messages/streaming/types.js";
import { AxleMessage } from "../../messages/types.js";
import { Recorder } from "../../recorder/recorder.js";
import { ToolDefinition } from "../../tools/types.js";
import { AIProvider, ModelResult } from "../types.js";
import { createGenerationRequestWithChatCompletion } from "./chatCompletion.js";
import { createStreamingRequest } from "./createStreamingRequest.js";
import { DEFAULT_MODEL, RESPONSES_API_MODELS } from "./models.js";
import { createGenerationRequestWithResponsesAPI } from "./responsesAPI.js";

export const NAME = "OpenAI" as const;

export class OpenAIProvider implements AIProvider {
  name = NAME;
  client: OpenAI;
  model: string;

  constructor(apiKey: string, model?: string | undefined) {
    this.model = model || DEFAULT_MODEL;
    this.client = new OpenAI({ apiKey: apiKey });
  }

  async createGenerationRequest(params: {
    messages: Array<AxleMessage>;
    system?: string;
    tools?: Array<ToolDefinition>;
    context: { recorder?: Recorder };
    options?: {
      temperature?: number;
      top_p?: number;
      max_tokens?: number;
      frequency_penalty?: number;
      presence_penalty?: number;
      stop?: string | string[];
      [key: string]: any;
    };
  }): Promise<ModelResult> {
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

  createStreamingRequest(params: {
    messages: Array<AxleMessage>;
    system?: string;
    tools?: Array<ToolDefinition>;
    context: { recorder?: Recorder };
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
    const { messages, system, tools, context, options } = params;
    return createStreamingRequest({
      client: this.client,
      model: this.model,
      messages,
      system,
      tools,
      runtime: context,
      options,
    });
  }
}
