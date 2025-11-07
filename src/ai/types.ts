import { Recorder } from "../recorder/recorder.js";
import { Stats } from "../types.js";
import { FileInfo } from "../utils/file.js";
import { Chat } from "./chat.js";

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
}

export interface AIRequest {
  execute(runtime: { recorder?: Recorder }): Promise<AIResponse>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string | Record<string, unknown>;
}

export type AIResponse = AISuccessResponse | AIErrorResponse;

export interface AISuccessResponse {
  type: "success";
  id: string;
  reason: StopReason;
  message: ChatItemAssistant;
  model: string;
  toolCalls?: ToolCall[];
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

export enum StopReason {
  Stop,
  Length,
  FunctionCall,
  Error,
}

export type ChatItem = ChatItemUser | ChatItemAssistant | ChatItemToolCall;

export interface ChatItemUser {
  role: "user";
  name?: string;
  content: string | ChatContent[];
}

export interface ChatItemAssistant {
  role: "assistant";
  content?: string;
  toolCalls?: ToolCall[];
}

export interface ChatItemToolCallResult {
  id: string;
  name: string;
  content: string;
}

export interface ChatItemToolCall {
  role: "tool";
  content: Array<ChatItemToolCallResult>;
}

export type ChatContent =
  | ChatContentText
  | ChatContentFile
  | ChatContentInstructions;

export interface ChatContentText {
  type: "text";
  text: string;
}

export interface ChatContentInstructions {
  type: "instructions";
  instructions: string;
}

export interface ChatContentFile {
  type: "file";
  file: FileInfo;
}
