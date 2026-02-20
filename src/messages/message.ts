import { AxleStopReason } from "../providers/types.js";
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
  content: Array<
    ContentPartText | ContentPartThinking | ContentPartToolCall | ContentPartInternalTool
  >;
  finishReason?: AxleStopReason;
}

export interface AxleToolCallMessage {
  role: "tool";
  content: Array<AxleToolCallResult>;
}

export type ToolResultPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface AxleToolCallResult {
  id: string;
  name: string;
  content: string | ToolResultPart[];
}

export type ContentPart =
  | ContentPartText
  | ContentPartFile
  | ContentPartToolCall
  | ContentPartThinking
  | ContentPartInternalTool;

export interface ContentPartText {
  type: "text";
  text: string;
}

export interface ContentPartFile {
  type: "file";
  file: FileInfo;
}

export interface ContentPartThinking {
  type: "thinking";
  id?: string;
  text: string;
  summary?: string;
  redacted?: boolean;
  encrypted?: string;
  signature?: string;
}

export interface ContentPartToolCall {
  type: "tool-call";
  id: string;
  name: string;
  parameters: Record<string, unknown>;
  providerMetadata?: Record<string, unknown>;
}

export interface ContentPartInternalTool {
  type: "internal-tool";
  id: string;
  name: string;
  input?: unknown;
  output?: unknown;
}
