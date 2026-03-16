import type { ActionResult, Turn, TurnPart } from "./types.js";
import type { Stats } from "../types.js";

export type AgentEvent =
  // Session
  | { type: "session:restore"; turns: Turn[]; config?: Record<string, unknown> }
  // Turn lifecycle
  | { type: "turn:user"; turn: Turn }
  | { type: "turn:start"; turnId: string }
  | { type: "turn:end"; turnId: string; usage: Stats }
  // Part streaming
  | { type: "part:start"; turnId: string; part: TurnPart }
  | { type: "text:delta"; turnId: string; partId: string; delta: string }
  | { type: "thinking:delta"; turnId: string; partId: string; delta: string }
  | { type: "part:end"; turnId: string; partId: string }
  // Action lifecycle
  | { type: "action:running"; turnId: string; partId: string; parameters?: Record<string, unknown> }
  | { type: "action:complete"; turnId: string; partId: string; result: ActionResult }
  | {
      type: "action:error";
      turnId: string;
      partId: string;
      error: { type: string; message: string };
    }
  // Nesting
  | { type: "action:child-event"; turnId: string; partId: string; event: AgentEvent }
  // Error
  | { type: "error"; error: { type: string; message: string } };
