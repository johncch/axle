import type {
  AxleToolCallMessage,
  AxleUserMessage,
  ContentPartInternalTool,
  ContentPartText,
  ContentPartThinking,
} from "../messages/message.js";
import type { ToolCallResult } from "../providers/helpers.js";
import type { AxleStopReason } from "../providers/types.js";

export type ToolCallStatus = "pending" | "running" | "complete" | "error";

export interface ClientContentPartToolCall {
  type: "tool-call";
  id: string;
  name: string;
  parameters: Record<string, unknown>;
  status: ToolCallStatus;
  result?: ToolCallResult | null;
}

export interface ClientAssistantMessage {
  role: "assistant";
  id: string;
  model?: string;
  content: Array<
    ContentPartText | ContentPartThinking | ClientContentPartToolCall | ContentPartInternalTool
  >;
  finishReason?: AxleStopReason;
}

export type ClientMessage = AxleUserMessage | ClientAssistantMessage | AxleToolCallMessage;

export type AgentStatus = "idle" | "ready" | "streaming" | "error";

export interface UseAgentSessionOptions {
  sessionId?: string;
}

export interface UseAgentSessionReturn {
  messages: ClientMessage[];
  status: AgentStatus;
  sessionId: string;
  send: (message: string) => void;
  cancel: () => void;
}
