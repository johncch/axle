import OpenAI from "openai";
import { Recorder } from "../../recorder/recorder.js";
import { Chat } from "../chat.js";
import { AIProvider, AIRequest } from "../types.js";
import { OpenAIChatCompletionRequest } from "./chatcompetion.js";
import { Models, RESPONSES_API_MODELS } from "./models.js";
import { OpenAIResponsesAPI } from "./responsesAPI.js";

const DEFAULT_MODEL = Models.GPT_4_1;

export class OpenAIProvider implements AIProvider {
  name = "OpenAI";
  client: OpenAI;
  model: string;

  constructor(apiKey: string, model?: string | undefined) {
    this.model = model || DEFAULT_MODEL;
    this.client = new OpenAI({ apiKey: apiKey });
  }

  createChatRequest(
    chat: Chat,
    context: { recorder?: Recorder } = {},
  ): AIRequest {
    const { recorder } = context;
    // TODO: We don't have enough information to check for multimodal support yet
    if ((RESPONSES_API_MODELS as readonly string[]).includes(this.model)) {
      return new OpenAIResponsesAPI(this, chat);
    }
    return new OpenAIChatCompletionRequest(this, chat);
  }
}
