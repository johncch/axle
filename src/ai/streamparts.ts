import {
  AxleAssistantMessage,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
} from "../messages/types.js";
import { Stats } from "../types.js";
import { AxleStopReason } from "./types.js";

export class StreamParts {
  private listeners = {
    start: new Set<(id: string) => void>(),
    text: new Set<(text: string) => void>(),
    // section: new Set<(title: string, text: string) => void>(),
    // file: new Set<(content: string) => void>(),
    thinking: new Set<(content: string) => void>(),
    "tool-call": new Set<(id: string, name: string) => void>(),
    "tool-call-complete": new Set<(id: string, name: string, args: any) => void>(),
    complete: new Set<(assistantMessage: AxleAssistantMessage) => void>(),
  };
  // private recorder?: Recorder;
  private isComplete = false;

  /* Events API */

  on(event: "start", handler: (id: string) => void): this;
  on(event: "text", handler: (text: string) => void): this;
  // on(event: "section", handler: (title: string, text: string) => void): this;
  // on(event: "file", handler: (content: string) => void): this;
  on(event: "thinking", handler: (content: string) => void): this;
  on(event: "tool-call", handler: (id: string, name: string) => void): this;
  on(event: "tool-call-complete", handler: (id: string, name: string, args: any) => void): this;
  on(event: "complete", handler: (assistantMessage: AxleAssistantMessage) => void): this;
  on(event: string, handler: (...args: any[]) => void): this {
    (this.listeners[event as keyof typeof this.listeners] as Set<any>).add(handler);
    return this;
  }

  emit(event: "start", id: string): void;
  emit(event: "text", text: string): void;
  // emit(event: "section", title: string, text: string): void;
  // emit(event: "file", content: string): void;
  emit(event: "thinking", content: string): void;
  emit(event: "tool-call", id: string, name: string): void;
  emit(event: "tool-call-complete", id: string, name: string, args: any): void;
  emit(event: "complete", assistantMessage: AxleAssistantMessage): void;
  emit(event: string, ...args: any[]): void {
    const set = this.listeners[event as keyof typeof this.listeners];
    if (!set) return;
    for (const fn of set) {
      (fn as any)(...args);
    }
  }

  /* Creation API */

  private id: string = "";
  private model: string = "";
  private parts: Array<ContentPartText | ContentPartToolCall | ContentPartThinking> = [];
  private finishReason: AxleStopReason;
  private stats: Stats; // TODO

  get partsLength(): number {
    return this.parts.length;
  }

  get currentId(): string {
    return this.id;
  }

  start(id: string, model: string) {
    this.id = id;
    this.model = model;
    this.emit("start", id);
  }

  complete(finishReason: AxleStopReason, stats: Stats) {
    if (this.isComplete) {
      return;
    }

    this.finishReason = finishReason;
    this.stats = stats;
    this.isComplete = true;

    const message: AxleAssistantMessage = {
      role: "assistant",
      content: this.parts.filter((p) => p.type === "text" || p.type === "thinking") as Array<
        ContentPartText | ContentPartThinking
      >,
      toolCalls: this.parts.filter((p) => p.type === "tool-call") as Array<ContentPartToolCall>,
      id: this.id,
      model: this.model,
    };

    this.emit("complete", message);
  }

  createText(index: number, text: string) {
    if (index < this.parts.length) {
      throw new Error(`Cannot create text at index ${index} because it already exists`);
    }
    this.parts.push({ type: "text", text });
    this.emit("text", text);
  }

  updateText(index: number, text: string) {
    const part = this.getPart(index, "text");
    if (part) {
      part.text += text;
      this.emit("text", part.text);
    }
  }

  createToolCall(index: number, id: string, name: string) {
    if (index < this.parts.length) {
      throw new Error(`Cannot create tool-call at index ${index} because it already exists`);
    }
    this.parts.push({ type: "tool-call", id, name, parameters: {} });
    this.emit("tool-call", id, name);
  }

  completeToolCall(index: number, args: any) {
    const part = this.getPart(index, "tool-call");
    if (part) {
      part.parameters = args;
      this.emit("tool-call-complete", part.id, part.name, args);
    }
  }

  createThinking(index: number, text: string) {
    if (index < this.parts.length) {
      throw new Error(`Cannot create thinking at index ${index} because it already exists`);
    }
    this.parts.push({ type: "thinking", text });
    this.emit("thinking", text);
  }

  updateThinking(index: number, text: string) {
    const part = this.getPart(index, "thinking");
    if (part) {
      part.text += text;
      this.emit("thinking", text);
    }
  }

  private getPart<T extends "text" | "tool-call" | "thinking">(
    index: number,
    type: T,
  ): T extends "text"
    ? ContentPartText | null
    : T extends "tool-call"
      ? ContentPartToolCall | null
      : T extends "thinking"
        ? ContentPartThinking | null
        : never {
    if (index < 0 || index >= this.parts.length) {
      return null as any;
    }

    const part = this.parts[index];
    return part.type === type ? (part as any) : null;
  }

  get currentMessage(): AxleAssistantMessage {
    return {
      role: "assistant",
      content: [...this.parts.filter((part) => part.type === "text" || part.type === "thinking")],
      toolCalls: [...this.parts.filter((part) => part.type === "tool-call")],
      id: this.id,
      model: this.model,
      ...(this.finishReason ? { finishReason: this.finishReason } : {}),
    };
  }
}
