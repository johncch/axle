import type { Transcript, Turn, TurnEvent } from "@fifthrevision/axle/ui";
import { render } from "ink";
import type { Renderer } from "../renderer.js";
import { App } from "./App.js";
import type { StaticItem } from "./store.js";
import { partitionTurns, UiStore } from "./store.js";

/**
 * Ink terminal-flow renderer: finished turns and host lines commit to
 * scrollback via `<Static>`; a small live region shows the in-flight turn
 * (streaming text tail, current action) with a spinner.
 */
export class InkRenderer implements Renderer {
  private store = new UiStore();
  private committed = new Set<string>();
  private instance: ReturnType<typeof render>;

  constructor() {
    this.instance = render(<App store={this.store} />, {
      exitOnCtrlC: false,
      patchConsole: false,
    });
  }

  renderPriorTurns(turns: readonly Turn[]): void {
    if (turns.length === 0) return;
    const items: StaticItem[] = turns.map((turn) => ({ kind: "turn", turn }));
    for (const turn of turns) this.committed.add(turn.id);
    this.store.update((state) => ({
      ...state,
      staticItems: [...state.staticItems, ...items],
    }));
  }

  onEvent(_event: TurnEvent, transcript: Transcript): void {
    const { newlyFinished, liveTurn } = partitionTurns(transcript.turns, this.committed);

    this.store.update((state) => ({
      staticItems: newlyFinished.length
        ? [...state.staticItems, ...newlyFinished]
        : state.staticItems,
      liveTurn,
    }));
  }

  info(message: string): void {
    this.host("info", message);
  }

  warn(message: string): void {
    this.host("warn", message);
  }

  error(message: string): void {
    this.host("error", message);
  }

  close(): void {
    // Commit a dangling live turn so an interrupted run still lands in scrollback.
    this.store.update((state) =>
      state.liveTurn
        ? {
            staticItems: [...state.staticItems, { kind: "turn", turn: state.liveTurn }],
            liveTurn: undefined,
          }
        : state,
    );
    this.instance.unmount();
  }

  private host(level: "info" | "warn" | "error", text: string): void {
    this.store.update((state) => ({
      ...state,
      staticItems: [...state.staticItems, { kind: "host", level, text }],
    }));
  }
}
