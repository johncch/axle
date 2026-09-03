import type { Transcript, Turn, TurnEvent, TurnPart } from "@fifthrevision/axle/ui";
import { ReadlinePrompt } from "./prompt.js";
import type { Renderer, SessionUsage } from "./renderer.js";

/**
 * Line-oriented streaming renderer: text deltas stream to the terminal as
 * they arrive, actions render as one-line markers. No cursor movement, no
 * ANSI state — safe for pipes and CI.
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
      case "part:end":
        this.endLine();
        break;
      case "action:running": {
        const part = findPart(transcript, event.turnId, event.partId);
        if (part?.type === "action") {
          this.line(`[${part.kind}] ${part.detail.name}`);
        }
        break;
      }
      case "action:error":
        this.line(`[error] ${event.error.message}`);
        break;
      case "error":
        this.line(`Error: ${event.error.message}`);
        break;
      default:
        break;
    }
  }

  info(message: string): void {
    this.line(message);
  }

  success(message: string): void {
    this.line(message);
  }

  warn(message: string): void {
    this.line(message);
  }

  error(message: string): void {
    this.line(message);
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
    if (part.type === "text" && part.text.trim()) {
      this.line(owner === "user" ? `> ${part.text.trimEnd()}` : part.text.trimEnd());
    } else if (part.type === "action") {
      this.line(`[${part.kind}] ${part.detail.name}`);
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
