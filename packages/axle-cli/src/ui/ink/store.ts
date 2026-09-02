import type { Turn } from "@fifthrevision/axle/ui";

export type StaticItem =
  { kind: "turn"; turn: Turn } | { kind: "host"; level: "info" | "warn" | "error"; text: string };

export interface UiState {
  staticItems: StaticItem[];
  liveTurn?: Turn;
}

export class UiStore {
  private state: UiState = { staticItems: [] };
  private listeners = new Set<() => void>();

  getSnapshot = (): UiState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  update(mutate: (state: UiState) => UiState): void {
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
