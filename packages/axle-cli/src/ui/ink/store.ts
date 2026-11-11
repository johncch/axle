import type { Turn, TurnPart } from "@fifthrevision/axle/ui";
import { marked } from "marked";
import type { ChatInput, SessionUsage } from "../renderer.js";

export type StaticItem =
  /** `continues` marks a turn whose first part resumes text already in scrollback. */
  | { kind: "turn"; turn: Turn; continues?: boolean }
  | { kind: "runner"; level: "info" | "success" | "warn" | "error"; text: string };

export interface UiState {
  staticItems: StaticItem[];
  /** What is left of the streaming turn after the parts already in scrollback. */
  liveTurn?: Turn;
  /** True when the live turn's first part resumes text already in scrollback. */
  liveContinues?: boolean;
  /** Turns the agent has accepted but not opened, from the transcript. */
  pending: readonly Turn[];
  /** True while the runner is waiting at the prompt (submit sends directly). */
  awaitingInput: boolean;
  /** Messages submitted while the runner is not prompting, consumed by the next prompt. */
  queuedInputs: ChatInput[];
  /** False when the model is known not to accept images; undefined when unknown. */
  imageInput?: boolean;
  /** Cumulative usage shown in the persistent bottom bar. */
  usage?: SessionUsage;
  /** Receives Ctrl-C pressed while a turn is running. */
  onInterrupt?: () => void;
  /** Set on close; hides the input line and usage bar in the final frame. */
  closed?: boolean;
}

export class UiStore<T = UiState> {
  private state: T;
  private listeners = new Set<() => void>();

  constructor(initial: T) {
    this.state = initial;
  }

  getSnapshot = (): T => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  update(mutate: (state: T) => T): void {
    this.state = mutate(this.state);
    for (const listener of this.listeners) listener();
  }
}

interface TurnProgress {
  /** Parts of the turn wholly in scrollback. */
  parts: number;
  /** Characters of the next part, a text part, already in scrollback. */
  offset: number;
}

/** What the renderer has already committed to scrollback. */
export interface CommitLog {
  finished: Set<string>;
  progress: Map<string, TurnProgress>;
}

export function createCommitLog(): CommitLog {
  return { finished: new Set(), progress: new Map() };
}

/**
 * Split the folded transcript into what to commit to scrollback and what is
 * still live. A finished turn commits whole. A streaming turn commits as it
 * goes: each settled part, and each finished markdown block of the text part
 * being written. Mutates `log`, so nothing is committed twice across calls.
 */
export function partitionTurns(
  turns: readonly Turn[],
  log: CommitLog,
): { commits: StaticItem[]; liveTurn?: Turn; liveContinues: boolean } {
  const commits: StaticItem[] = [];
  let liveTurn: Turn | undefined;
  let liveContinues = false;

  for (const turn of turns) {
    if (log.finished.has(turn.id)) continue;
    const from = log.progress.get(turn.id) ?? { parts: 0, offset: 0 };

    if (turn.status !== "streaming") {
      commits.push(
        from.parts === 0 && from.offset === 0
          ? { kind: "turn", turn }
          : {
              kind: "turn",
              turn: { ...turn, parts: partsFrom(turn, from) },
              continues: from.offset > 0,
            },
      );
      log.finished.add(turn.id);
      log.progress.delete(turn.id);
      continue;
    }

    const to = advance(turn, from);
    if (to.parts !== from.parts || to.offset !== from.offset) {
      commits.push({
        kind: "turn",
        turn: { ...turn, parts: partsBetween(turn, from, to) },
        continues: from.offset > 0,
      });
      log.progress.set(turn.id, to);
    }
    liveTurn = { ...turn, parts: partsFrom(turn, to) };
    liveContinues = to.offset > 0;
  }

  return { commits, liveTurn, liveContinues };
}

function advance(turn: Turn, from: TurnProgress): TurnProgress {
  let { parts, offset } = from;
  while (parts < turn.parts.length) {
    const part = turn.parts[parts];
    if (parts === turn.parts.length - 1) {
      if (part.type === "text") offset += finishedBlocksLength(part.text.slice(offset));
      break;
    }
    if (isRunning(part)) break;
    parts++;
    offset = 0;
  }
  return { parts, offset };
}

function isRunning(part: TurnPart): boolean {
  return (
    (part.type === "action" || part.type === "compaction") &&
    (part.status === "pending" || part.status === "running")
  );
}

function partsFrom(turn: Turn, from: TurnProgress): TurnPart[] {
  return partsBetween(turn, from, { parts: turn.parts.length, offset: 0 });
}

function partsBetween(turn: Turn, from: TurnProgress, to: TurnProgress): TurnPart[] {
  const parts: TurnPart[] = [];
  for (let index = from.parts; index <= to.parts && index < turn.parts.length; index++) {
    const part = turn.parts[index];
    const start = index === from.parts ? from.offset : 0;
    const end = index === to.parts ? to.offset : undefined;
    if (end !== undefined && end <= start) continue;
    parts.push(
      part.type === "text" && (start > 0 || end !== undefined)
        ? { ...part, text: part.text.slice(start, end) }
        : part,
    );
  }
  return parts;
}

/**
 * Length of the leading markdown blocks that later text cannot change: every
 * block before the last one.
 */
function finishedBlocksLength(text: string): number {
  const tokens = marked.lexer(text);
  let last = tokens.length - 1;
  while (last >= 0 && tokens[last].type === "space") last--;

  let length = 0;
  for (const token of tokens.slice(0, Math.max(last, 0))) {
    if (!text.startsWith(token.raw, length)) return 0;
    length += token.raw.length;
  }
  return length;
}
