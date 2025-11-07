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

export class OpenAIProvider implements AIProvider {
  name = "OpenAI";
  client: OpenAI;
  model: string;

  constructor(apiKey: string, model?: string | undefined) {
    this.model = model || DEFAULT_MODEL;
    this.client = new OpenAI({ apiKey: apiKey });
  }

  async createGenerationRequest(params: {
    messages: Array<AxleMessage>;
    tools?: Array<ToolDefinition>;
    context: { recorder?: Recorder };
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
    tools?: Array<ToolDefinition>;
    context: { recorder?: Recorder };
  }): AsyncGenerator<AnyStreamChunk, void, unknown> {
    const { messages, tools, context } = params;
    return createStreamingRequest({
      client: this.client,
      model: this.model,
      messages,
      tools,
      runtime: context,
    });
  }
}
