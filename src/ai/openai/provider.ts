import OpenAI from "openai";
import { Chat } from "../../messages/chat.js";
import { AxleMessage } from "../../messages/types.js";
import { Recorder } from "../../recorder/recorder.js";
import { ToolDef } from "../../tools/types.js";
import { AIProvider, AIRequest, GenerationResult } from "../types.js";
import {
  createGenerationRequestWithChatCompletion,
  OpenAIChatCompletionRequest,
} from "./chatCompletion.js";
import { DEFAULT_MODEL, RESPONSES_API_MODELS } from "./models.js";
import { createGenerationRequestWithResponsesAPI, OpenAIResponsesAPI } from "./responsesAPI.js";

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
  }): Promise<GenerationResult> {
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
