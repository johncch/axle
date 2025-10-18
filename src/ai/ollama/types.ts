import { ContentPartToolCall } from "../../messages/types.js";

/* Requests */

export interface OllamaRequest {
  model: string;
  messages: OllamaMessage[];
  tools?: Array<OllamaTool>;
}

export interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: { [key: string]: unknown };
    strict?: boolean | null;
  };
}

/* Responses */

export type OllamaMessage =
  | OllamaUserMessage
  | OllamaAsistantMessage
  | OllamaSystemMessage
  | OllamaToolMessage;

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
