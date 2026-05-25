import type { AxleAssistantMessage, AxleMessage } from "../messages/message.js";
import type { Stats } from "../types.js";
import { AxleError } from "./AxleError.js";

export class AxleAbortError extends AxleError {
  public readonly reason: unknown;
  public readonly messages?: AxleMessage[];
  public readonly partial?: AxleAssistantMessage;
  public readonly usage?: Stats;

  constructor(
    message = "Operation aborted",
    options?: {
      reason?: unknown;
      messages?: AxleMessage[];
      partial?: AxleAssistantMessage;
      usage?: Stats;
    },
  ) {
    super(message, {
      code: "ABORTED",
      details: {
        reason: options?.reason,
        usage: options?.usage,
      },
    });
    this.name = "AbortError";
    this.reason = options?.reason;
    this.messages = options?.messages;
    this.partial = options?.partial;
    this.usage = options?.usage;

    Object.setPrototypeOf(this, AxleAbortError.prototype);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      reason: this.reason,
      ...(this.messages ? { messages: this.messages } : {}),
      ...(this.partial ? { partial: this.partial } : {}),
      ...(this.usage ? { usage: this.usage } : {}),
    };
  }
}
