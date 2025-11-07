import { AxleStopReason } from "../ai/types.js";
import { FileInfo } from "../utils/file.js";

export type AxleMessage = AxleUserMessage | AxleAssistantMessage | AxleToolCallMessage;

export interface AxleUserMessage {
  role: "user";
  name?: string;
  content: string | Array<ContentPart>;
}

export interface AxleAssistantMessage {
  role: "assistant";
  id: string;
  model?: string;
  content: Array<ContentPartText | ContentPartThinking>;
  toolCalls?: Array<ContentPartToolCall>;
  finishReason?: AxleStopReason;
}

export interface AxleToolCallMessage {
  role: "tool";
  content: Array<AxleToolCallResult>;
}

export interface AxleToolCallResult {
  id: string;
  name: string;
  content: string;
}

export type ContentPart =
  | ContentPartText
  | ContentPartFile
  | ContentPartInstructions
  | ContentPartThinking;

export interface ContentPartText {
  type: "text";
  text: string;
}

export interface ContentPartInstructions {
  type: "instructions";
  instructions: string;
}

export interface ContentPartFile {
  type: "file";
  file: FileInfo;
}

export interface ContentPartThinking {
  type: "thinking";
  text: string;
  redacted?: boolean;
  signature?: string;
}

export interface ContentPartToolCall {
  type: "tool-call";
  id: string;
  name: string;
  parameters: string | Record<string, unknown>;
}
