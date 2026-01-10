import { AxleStopReason } from "../ai/types.js";
import { AxleAssistantMessage, AxleMessage, AxleToolCallResult, AxleUserMessage } from "./types.js";

export class Conversation {
  system: string;
  private _messages: AxleMessage[] = [];

  constructor(messages?: AxleMessage[]) {
    if (messages) {
      this._messages = messages;
    }
  }

  get messages() {
    return [...this._messages];
  }

  addSystem(message: string) {
    this.system = message;
  }

  addUser(message: string): void;
  addUser(parts: AxleUserMessage["content"]): void;
  addUser(args: string | AxleUserMessage["content"]) {
    if (typeof args === "string") {
      this._messages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: args,
          },
        ],
      });
    } else {
      this._messages.push({ role: "user", content: args });
    }
  }

  addAssistant(message: string): void;
  addAssistant(params: Omit<AxleAssistantMessage, "role">): void;
  addAssistant(obj: string | Omit<AxleAssistantMessage, "role">): void {
    if (typeof obj === "string") {
      const text = obj as string;
      this._messages.push({
        role: "assistant",
        id: crypto.randomUUID(),
        content: [{ type: "text", text }],
        model: "user",
        finishReason: AxleStopReason.Custom,
      });
    } else {
      this._messages.push({
        role: "assistant",
        ...obj,
      });
    }
  }

  addToolResults(input: Array<AxleToolCallResult>) {
    this._messages.push({
      role: "tool",
      content: input,
    });
  }

  add(messages: AxleMessage | AxleMessage[]) {
    if (Array.isArray(messages)) {
      this._messages.push(...messages);
    } else {
      this._messages.push(messages);
    }
  }

  latest(): AxleMessage | undefined {
    return this._messages[this._messages.length - 1];
  }

  toString() {
    return JSON.stringify({
      system: this.system,
      messages: this._messages,
    });
  }
}
