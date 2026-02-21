import type { AxleMessage } from "../messages/message.js";
import type { FileStore } from "../store/types.js";
import type { ExecutableTool } from "../tools/types.js";
import type { TracingContext } from "../tracer/types.js";

export interface MemoryContext {
  name?: string;
  scope?: Record<string, string>;
  system?: string;
  messages: AxleMessage[];
  newMessages?: AxleMessage[];
  store: FileStore;
  tracer?: TracingContext;
}

export interface RecallResult {
  systemSuffix?: string;
}

export interface AgentMemory {
  recall(context: MemoryContext): Promise<RecallResult>;
  record(context: MemoryContext): Promise<void>;
  tools?(): ExecutableTool[];
}
