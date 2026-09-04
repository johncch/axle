import type { Turn } from "@fifthrevision/axle/ui";
import type { SessionUsage } from "../renderer.js";

export type StaticItem =
  | { kind: "turn"; turn: Turn }
  | { kind: "host"; level: "info" | "success" | "warn" | "error"; text: string };

export interface UiState {
  staticItems: StaticItem[];
  liveTurn?: Turn;
  /** True while the runner is waiting at the prompt (submit sends directly). */
  awaitingInput: boolean;
  /** Lines submitted during a running turn, consumed by the next prompt. */
  queuedInputs: string[];
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

/**
 * Split the folded transcript into turns to commit to scrollback and the one
 * still streaming. Mutates `committed` to mark newly finished turn ids, so a
 * turn is committed exactly once across calls.
 */
export function partitionTurns(
  turns: readonly Turn[],
  committed: Set<string>,
): { newlyFinished: StaticItem[]; liveTurn?: Turn } {
  const newlyFinished: StaticItem[] = [];
  let liveTurn: Turn | undefined;

  for (const turn of turns) {
    if (committed.has(turn.id)) continue;
    if (turn.status === "streaming") {
      liveTurn = turn;
    } else {
      newlyFinished.push({ kind: "turn", turn });
      committed.add(turn.id);
    }
  }

  return { newlyFinished, liveTurn };
}
