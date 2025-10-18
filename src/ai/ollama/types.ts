import { ContentPartToolCall } from "../../messages/types.js";

export interface OllamaRequest {
  model: string;
  messages: OllamaMessage[];
}

export type OllamaMessage = OllamaUserMessage | OllamaAsistantMessage | OllamaSystemMessage | OllamaToolMessage;

export interface OllamaUserMessage {
  role: "user";
  content: string;
  images?: string[];
}

export interface OllamaAsistantMessage {
  role: "assistant";
  content: string;
  tool_calls?: ContentPartToolCall[];
}

export interface OllamaSystemMessage {
  role: "system";
  content: string;
}

export interface OllamaToolMessage {
  role: "tool";
  content: string;
  tool_call_id: string;
}
