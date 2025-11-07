import Anthropic from "@anthropic-ai/sdk";
import { Recorder } from "../../recorder/recorder.js";

import { AnyStreamChunk } from "../../messages/streaming/types.js";
import { AxleMessage } from "../../messages/types.js";
import { ToolDefinition } from "../../tools/types.js";
import { AIProvider, ModelResult } from "../types.js";
import { createGenerationRequest } from "./createGenerationRequest.js";
import { createStreamingRequest } from "./createStreamingRequest.js";
import { DEFAULT_MODEL } from "./models.js";

export class AnthropicProvider implements AIProvider {
  name = "Anthropic";
  client: Anthropic;
  model: string;

  constructor(apiKey: string, model?: string) {
    this.model = model ?? DEFAULT_MODEL;
    this.client = new Anthropic({
      apiKey: apiKey,
    });
  }

  async createGenerationRequest(params: {
    messages: Array<AxleMessage>;
    tools?: Array<ToolDefinition>;
    context: { recorder?: Recorder };
  }): Promise<ModelResult> {
    return await createGenerationRequest({ client: this.client, model: this.model, ...params });
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
