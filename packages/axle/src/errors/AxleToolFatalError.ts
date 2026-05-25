import type { AxleAssistantMessage, AxleMessage } from "../messages/message.js";
import type { Stats } from "../types.js";
import { AxleError } from "./AxleError.js";

export class AxleToolFatalError extends AxleError {
  public readonly toolName?: string;
  public readonly messages?: AxleMessage[];
  public readonly partial?: AxleAssistantMessage;
  public readonly usage?: Stats;

  constructor(
    message = "Fatal tool error",
    options?: {
      toolName?: string;
      messages?: AxleMessage[];
      partial?: AxleAssistantMessage;
      usage?: Stats;
      cause?: unknown;
    },
  ) {
    super(message, {
      code: "TOOL_FATAL_ERROR",
      details: {
        toolName: options?.toolName,
        usage: options?.usage,
      },
      cause: options?.cause,
    });
    this.toolName = options?.toolName;
    this.messages = options?.messages;
    this.partial = options?.partial;
    this.usage = options?.usage;

    Object.setPrototypeOf(this, AxleToolFatalError.prototype);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      ...(this.toolName ? { toolName: this.toolName } : {}),
      ...(this.messages ? { messages: this.messages } : {}),
      ...(this.partial ? { partial: this.partial } : {}),
      ...(this.usage ? { usage: this.usage } : {}),
    };
  }
}
