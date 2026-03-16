import type { Turn } from "../turns/types.js";

export type AgentStatus = "idle" | "ready" | "streaming" | "error";

export interface UseAgentSessionOptions {
  sessionId?: string;
  config?: Record<string, unknown>;
}

export interface UseAgentSessionReturn {
  turns: Turn[];
  status: AgentStatus;
  sessionId: string;
  send: (message: string) => void;
  cancel: () => void;
}
