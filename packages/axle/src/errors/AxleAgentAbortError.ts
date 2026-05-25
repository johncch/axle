import type { AxleAssistantMessage, AxleMessage } from "../messages/message.js";
import type { Turn } from "../turns/types.js";
import type { Stats } from "../types.js";
import { AxleAbortError } from "./AxleAbortError.js";

export class AxleAgentAbortError extends AxleAbortError {
  public readonly turn?: Turn;

  constructor(
    message = "Agent send aborted",
    options?: {
      reason?: unknown;
      messages?: AxleMessage[];
      partial?: AxleAssistantMessage;
      turn?: Turn;
      usage?: Stats;
    },
  ) {
    super(message, options);
    this.turn = options?.turn;

    Object.setPrototypeOf(this, AxleAgentAbortError.prototype);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      ...(this.turn ? { turn: this.turn } : {}),
    };
  }
}
