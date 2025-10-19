import {
  AxleMessage,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
} from "../messages/types.js";
import { Recorder } from "../recorder/recorder.js";
import { ToolDefinition } from "../tools/types.js";
// import { ToolDef } from "../tools/types.js";
import { Stats } from "../types.js";

/*
 Vendor specific configuration
 */
export type OllamaProviderConfig = { url?: string; model: string };
export type AnthropicProviderConfig = { "api-key": string; model?: string };
export type OpenAIProviderConfig = { "api-key": string; model?: string };
export type GoogleAIProviderConfig = { "api-key": string; model?: string };

export interface AIProviderConfig {
  ollama: OllamaProviderConfig;
  anthropic: AnthropicProviderConfig;
  openai: OpenAIProviderConfig;
  googleai: GoogleAIProviderConfig;
}

/*
 General AI Interfaces
 */

export interface AIProvider {
  get name(): string;
  get model(): string;

  createGenerationRequest(params: {
    messages: Array<AxleMessage>;
    tools?: Array<ToolDefinition>;
    context: { recorder?: Recorder };
  }): Promise<GenerationResult>;

  // createStreamingRequest(params: {
  //   messages: Array<AxleMessage>;
  //   tools?: Array<ToolDef>;
  //   context: { recorder?: Recorder };
  // }): AsyncGenerator<AnyStreamChunk, void, unknown>;
}

export type GenerationResult = GenerationSuccessResult | GenerationErrorResult;

export interface GenerationSuccessResult {
  type: "success";
  role: "assistant";
  id: string;
  model: string;
  text: string;
  content: Array<ContentPartText | ContentPartThinking>;
  reason: AxleStopReason;
  toolCalls?: ContentPartToolCall[];
  usage: Stats;
  raw: any;
}

export interface GenerationErrorResult {
  type: "error";
  error: {
    type: string;
    message: string;
  };
  usage: Stats;
  raw: any;
}

export enum AxleStopReason {
  Stop,
  Length,
  FunctionCall,
  Error,
  Custom,
}
