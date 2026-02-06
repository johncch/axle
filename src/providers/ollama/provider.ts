import { AnyStreamChunk } from "../../messages/streaming/types.js";
import { AxleMessage } from "../../messages/types.js";
import type { TracingContext } from "../../tracer/types.js";
import { ToolDefinition } from "../../tools/types.js";
import { AIProvider, ModelResult } from "../types.js";
import { createGenerationRequest } from "./createGenerationRequest.js";
import { createStreamingRequest } from "./createStreamingRequest.js";

export const DEFAULT_OLLAMA_URL = "http://localhost:11434";
export const NAME = "Ollama" as const;

export class OllamaProvider implements AIProvider {
  name = "Ollama";
  url: string;
  model: string;

  constructor(model: string, url?: string) {
    this.url = url || DEFAULT_OLLAMA_URL;
    this.model = model;
  }

  async createGenerationRequest(params: {
    messages: Array<AxleMessage>;
    system?: string;
    tools?: Array<ToolDefinition>;
    context: { tracer?: TracingContext };
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
    return await createGenerationRequest({
      url: this.url,
      model: this.model,
      ...params,
    });
  }

  createStreamingRequest(params: {
    messages: Array<AxleMessage>;
    system?: string;
    tools?: Array<ToolDefinition>;
    context: { tracer?: TracingContext };
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
      url: this.url,
      model: this.model,
      messages,
      system,
      tools,
      runtime: context,
      options,
    });
  }
}
