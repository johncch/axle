import { AxleStopReason } from "../../ai/types.js";
import { Stats } from "../../types.js";
import { AxleAssistantMessage, ContentPartText, ContentPartThinking } from "../types.js";
import { AnyStreamChunk } from "./types.js";

export class MessageBuilder {
  private id?: string;
  private model?: string;
  private chunks: Array<AnyStreamChunk> = [];
  private parts: Array<ContentPartText | ContentPartThinking> = [];
  private finishReason?: AxleStopReason;

  private usage: Stats;

  private isComplete = false;

  addChunk(chunk: AnyStreamChunk): void {
    this.chunks.push(chunk);

    switch (chunk.type) {
      case "start":
        this.id = chunk.id;
        this.model = chunk.data.model;
        break;

      case "text":
        // TODO
        break;

      case "thinking-start":
        // TODO
        break;

      case "thinking-delta":
        // TODO
        break;

      case "tool-call-start":
        // TODO
        break;

      case "tool-call-complete":
        // TODO
        break;

      case "complete":
        this.isComplete = true;
        this.finishReason = chunk.data.finishReason;
        this.usage = {
          in: chunk.data.usage.in,
          out: chunk.data.usage.out,
        };
        break;

      case "error":
        // TODO
        break;
    }
  }

  get current(): Partial<AxleAssistantMessage> {
    return {
      role: "assistant",
      id: this.id,
      content: this.parts.filter((p) => p),
      model: this.model,
    };
  }

  get complete(): AxleAssistantMessage | null {
    if (!this.isComplete) return null;

    return {
      role: "assistant",
      id: this.id,
      model: this.model,
      content: this.parts.filter((p) => p),
      finishReason: this.finishReason,
      // usage: //
    };
  }
}
