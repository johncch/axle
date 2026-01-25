import { AnyStreamChunk } from "../messages/streaming/types.js";
import {
  AxleMessage,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
} from "../messages/types.js";
import type { TracingContext } from "../tracer/types.js";
import { ToolDefinition } from "../tools/types.js";
import { Stats } from "../types.js";

/*
 Vendor specific configuration
 */
export type OllamaProviderConfig = { url?: string; model: string };
export type AnthropicProviderConfig = { "api-key": string; model?: string };
export type OpenAIProviderConfig = { "api-key": string; model?: string };
export type GeminiProviderConfig = { "api-key": string; model?: string };

export interface AIProviderConfig {
  ollama: OllamaProviderConfig;
  anthropic: AnthropicProviderConfig;
  openai: OpenAIProviderConfig;
  gemini: GeminiProviderConfig;
}

/*
 General AI Interfaces
 */

export interface AIProvider {
  get name(): string;
  get model(): string;

  createGenerationRequest(params: {
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
  }): Promise<ModelResult>;

  createStreamingRequest?(params: {
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
  }): AsyncGenerator<AnyStreamChunk, void, unknown>;
}

export interface ModelResponse {
  type: "success";
  role: "assistant";
  id: string;
  model: string;
  text: string;
  content: Array<ContentPartText | ContentPartThinking | ContentPartToolCall>;
  finishReason: AxleStopReason;
  usage: Stats;
  raw: any;
}

export interface ModelError {
  type: "error";
  error: {
    type: string;
    message: string;
  };
  usage?: Stats;
  raw?: any;
}

export type ModelResult = ModelResponse | ModelError;

export enum AxleStopReason {
  Stop,
  Length,
  FunctionCall,
  Error,
  Custom,
}
