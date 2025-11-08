import Anthropic from "@anthropic-ai/sdk";
import { Recorder } from "../../recorder/recorder.js";

import { AnyStreamChunk } from "../../messages/streaming/types.js";
import { AxleMessage } from "../../messages/types.js";
import { ToolDefinition } from "../../tools/types.js";
import { AIProvider, ModelResult } from "../types.js";
import { createGenerationRequest } from "./createGenerationRequest.js";
import { createStreamingRequest } from "./createStreamingRequest.js";
import { DEFAULT_MODEL } from "./models.js";

export const NAME = "anthorpic" as const;

export class AnthropicProvider implements AIProvider {
  name = NAME;
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
    return await createGenerationRequest({ client: this.client, model: this.model, ...params });
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
