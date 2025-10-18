import { Chat } from "../messages/chat.js";
import { AxleAssistantMessage, AxleMessage, ContentPartToolCall } from "../messages/types.js";
import { Recorder } from "../recorder/recorder.js";
import { ToolDef } from "../tools/types.js";
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
  createChatRequest(chat: Chat, context: { recorder?: Recorder }): AIRequest;
  createGenerationRequest(params: {
    messages: Array<AxleMessage>;
    tools?: Array<ToolDef>;
    context: { recorder?: Recorder };
  }): Promise<AIResponse>;

  // createStreamingRequest(params: {
  //   messages: Array<AxleMessage>;
  //   tools?: Array<ToolDef>;
  //   context: { recorder?: Recorder };
  // }): AsyncGenerator<AnyStreamChunk, void, unknown>;
}

export interface AIRequest {
  execute(runtime: { recorder?: Recorder }): Promise<AIResponse>;
}

export type AIResponse = AISuccessResponse | AIErrorResponse;

export interface AISuccessResponse {
  type: "success";
  id: string;
  reason: AxleStopReason;
  message: AxleAssistantMessage;
  model: string;
  toolCalls?: ContentPartToolCall[];
  usage: Stats;
  raw: any;
}

export interface AIErrorResponse {
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
}
