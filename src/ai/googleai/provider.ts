import { GoogleGenAI } from "@google/genai";
import { AxleMessage } from "../../messages/types.js";
import { Recorder } from "../../recorder/recorder.js";
import { ToolDefinition } from "../../tools/types.js";
import { AIProvider, ModelResult } from "../types.js";
import { createGenerationRequest } from "./createGenerationRequest.js";
import { DEFAULT_MODEL } from "./models.js";

export class GoogleAIProvider implements AIProvider {
  name = "GoogleAI";
  client: GoogleGenAI;
  model: string;

  constructor(apiKey: string, model?: string) {
    this.model = model ?? DEFAULT_MODEL;
    this.client = new GoogleGenAI({ apiKey: apiKey });
  }

  async createGenerationRequest(params: {
    messages: Array<AxleMessage>;
    tools?: Array<ToolDefinition>;
    context: { recorder?: Recorder };
  }): Promise<ModelResult> {
    return await createGenerationRequest({
      client: this.client,
      model: this.model,
      ...params,
    });
  }
}
