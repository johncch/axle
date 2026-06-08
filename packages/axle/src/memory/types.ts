import type { AxleMessage } from "../messages/message.js";
import type { Span } from "../observability/types.js";
import type { ExecutableTool } from "../tools/types.js";

export interface MemoryContext {
  /** Optional agent name provided by the host. */
  agentName?: string;
  /** Stable conversation/session id from the agent. */
  sessionId: string;
  /** Current system prompt, before memory augmentation. */
  system?: string;
  /** Full message context available for recall or extraction. */
  messages: AxleMessage[];
  /** Newly produced messages to record after a turn completes. */
  newMessages?: AxleMessage[];
  /** Optional tracing context. */
  span?: Span;
}

export interface RecallResult {
  systemSuffix?: string;
}

export interface AgentMemory {
  recall(context: MemoryContext): Promise<RecallResult>;
  record(context: MemoryContext): Promise<void>;
  tools?(): ExecutableTool[];
}
