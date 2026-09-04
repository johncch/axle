import type { Transcript, Turn, TurnEvent, TurnPart } from "@fifthrevision/axle/ui";
import { capitalize, formatActionArgs, formatDuration, indentContinuation } from "./format.js";
import { ReadlinePrompt } from "./prompt.js";
import type { Renderer, SessionUsage } from "./renderer.js";

/**
 * Line-oriented renderer speaking the same consola/task-runner dialect as
 * ink, minus color, animation, and the live region — a piped or CI log reads
 * like a frozen ink transcript. Text deltas stream as they arrive; actions
 * print once, settled, with duration. No cursor movement, no ANSI state.
 */
export class PlainRenderer implements Renderer {
  private write: (text: string) => void;
  private atLineStart = true;
  private readline = new ReadlinePrompt();

  constructor(options?: { write?: (text: string) => void }) {
    this.write = options?.write ?? ((text) => process.stdout.write(text));
  }

  promptInput(): Promise<string | null> {
    this.endLine();
    this.atLineStart = true;
    return this.readline.prompt();
  }

  renderPriorTurns(turns: readonly Turn[]): void {
    for (const turn of turns) {
      for (const part of turn.parts) {
        this.renderStaticPart(turn.owner, part);
      }
    }
  }

  onEvent(event: TurnEvent, transcript: Transcript): void {
    switch (event.type) {
      case "text:delta":
        this.emit(event.delta);
        break;
      case "part:end": {
        const part = findPart(transcript, event.turnId, event.partId);
        if (part?.type === "thinking") {
          this.renderStaticPart("agent", part);
        } else {
          this.endLine();
        }
        break;
      }
      case "action:complete":
      case "action:error": {
        const part = findPart(transcript, event.turnId, event.partId);
        if (part?.type === "action") {
          this.renderStaticPart("agent", part);
        }
        break;
      }
      case "compaction:complete":
      case "compaction:error": {
        const part = findPart(transcript, event.turnId, event.partId);
        if (part?.type === "compaction") {
          this.renderStaticPart("agent", part);
        }
        break;
      }
      case "error":
        this.line(`✖ ${event.error.message}`);
        break;
      default:
        break;
    }
  }

  info(message: string): void {
    this.line(`ℹ ${indentContinuation(message)}`);
  }

  success(message: string): void {
    this.line(`✔ ${indentContinuation(message)}`);
  }

  warn(message: string): void {
    this.line(`⚠ ${indentContinuation(message)}`);
  }

  error(message: string): void {
    this.line(`✖ ${indentContinuation(message)}`);
  }

  updateUsage(_usage: SessionUsage): void {
    // Line-oriented output has no persistent bar; the end-of-run summary
    // covers totals.
  }

  setInterruptHandler(_handler: (() => void) | undefined): void {
    // Cooked-mode terminal: Ctrl-C during a turn arrives as a real SIGINT,
    // which the runner already listens for.
  }

  close(): void {
    this.readline.close();
    this.endLine();
  }

  private renderStaticPart(owner: Turn["owner"], part: TurnPart): void {
    switch (part.type) {
      case "text": {
        if (!part.text.trim()) return;
        const text = part.text.trim();
        this.line(owner === "user" ? `❯ ${indentContinuation(text)}` : text);
        return;
      }
      case "thinking": {
        const duration = formatDuration(part.timing);
        this.line(`✔ Thinking${duration ? ` (${duration})` : ""}`);
        return;
      }
      case "action": {
        const glyph = part.status === "error" ? "✖" : part.status === "cancelled" ? "⚠" : "✔";
        const args = formatActionArgs(part);
        const duration = part.status === "complete" ? formatDuration(part.timing) : undefined;
        this.line(
          `${glyph} ${capitalize(part.detail.name)}${args ? ` ${args}` : ""}${duration ? ` (${duration})` : ""}${part.status === "cancelled" ? " (cancelled)" : ""}`,
        );
        return;
      }
      case "compaction": {
        if (part.status === "error") {
          this.line(`✖ Compaction failed: ${part.error}`);
          return;
        }
        const duration = formatDuration(part.timing);
        this.line(`✔ Compacted context${duration ? ` (${duration})` : ""}`);
        return;
      }
      default:
        return;
    }
  }

  private emit(text: string): void {
    if (text.length === 0) return;
    this.write(text);
    this.atLineStart = text.endsWith("\n");
  }

  private endLine(): void {
    if (!this.atLineStart) this.emit("\n");
  }

  private line(text: string): void {
    this.endLine();
    this.emit(text + "\n");
  }
}

function findPart(transcript: Transcript, turnId: string, partId: string): TurnPart | undefined {
  return transcript.getTurn(turnId)?.parts.find((part) => part.id === partId);
}
