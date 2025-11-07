import { AnyStreamChunk } from "../../messages/streaming/types.js";
import { AxleMessage } from "../../messages/types.js";
import { Recorder } from "../../recorder/recorder.js";
import { ToolDefinition } from "../../tools/types.js";
import { AIProvider, ModelResult } from "../types.js";
import { createGenerationRequest } from "./createGenerationRequest.js";
import { createStreamingRequest } from "./createStreamingRequest.js";

const DEFAULT_OLLAMA_URL = "http://localhost:11434";

export class OllamaProvider implements AIProvider {
  name = "Ollama";
  url: string;
  model: string;
  recorder?: Recorder;

  constructor(model: string, url?: string) {
    this.url = url || DEFAULT_OLLAMA_URL;
    this.model = model;
  }

  async createGenerationRequest(params: {
    messages: Array<AxleMessage>;
    tools?: Array<ToolDefinition>;
    context: { recorder?: Recorder };
  }): Promise<ModelResult> {
    return await createGenerationRequest({
      url: this.url,
      model: this.model,
      ...params,
    });
  }

  createStreamingRequest(params: {
    messages: Array<AxleMessage>;
    tools?: Array<ToolDefinition>;
    context: { recorder?: Recorder };
  }): AsyncGenerator<AnyStreamChunk, void, unknown> {
    const { messages, tools, context } = params;
    return createStreamingRequest({
      url: this.url,
      model: this.model,
      messages,
      tools,
      runtime: context,
    });
  }
}
