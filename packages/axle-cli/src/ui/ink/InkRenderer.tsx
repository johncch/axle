import type { Transcript, Turn, TurnEvent } from "@fifthrevision/axle/ui";
import { render } from "ink";
import type { Renderer, SessionUsage } from "../renderer.js";
import { App } from "./App.js";
import type { StaticItem } from "./store.js";
import { partitionTurns, UiStore } from "./store.js";

/**
 * Ink terminal-flow renderer: finished turns and host lines commit to
 * scrollback via `<Static>`; a small live region shows the in-flight turn
 * (streaming text tail, current action) with a spinner. The chat input line
 * renders inside the app while a prompt is pending.
 */
export class InkRenderer implements Renderer {
  private store = new UiStore();
  private committed = new Set<string>();
  private instance: ReturnType<typeof render>;
  private waiter?: (value: string | null) => void;

  constructor() {
    this.instance = render(<App store={this.store} onSubmit={this.handleSubmit} />, {
      exitOnCtrlC: false,
      patchConsole: false,
    });
  }

  private handleSubmit = (value: string | null): void => {
    const waiter = this.waiter;
    if (waiter) {
      this.waiter = undefined;
      this.store.update((state) => ({ ...state, awaitingInput: false }));
      waiter(value);
    } else if (value !== null) {
      this.store.update((state) => ({
        ...state,
        queuedInputs: [...state.queuedInputs, value],
      }));
    }
  };

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
      ...state,
      staticItems: newlyFinished.length
        ? [...state.staticItems, ...newlyFinished]
        : state.staticItems,
      liveTurn,
    }));
  }

  info(message: string): void {
    this.host("info", message);
  }

  success(message: string): void {
    this.host("success", message);
  }

  warn(message: string): void {
    this.host("warn", message);
  }

  error(message: string): void {
    this.host("error", message);
  }

  updateUsage(usage: SessionUsage): void {
    this.store.update((state) => ({ ...state, usage }));
  }

  setInterruptHandler(handler: (() => void) | undefined): void {
    this.store.update((state) => ({ ...state, onInterrupt: handler }));
  }

  promptInput(): Promise<string | null> {
    const queued = this.store.getSnapshot().queuedInputs;
    if (queued.length > 0) {
      const [next, ...rest] = queued;
      this.store.update((state) => ({ ...state, queuedInputs: rest }));
      return Promise.resolve(next);
    }
    return new Promise((resolve) => {
      this.waiter = resolve;
      this.store.update((state) => ({ ...state, awaitingInput: true }));
    });
  }

  async close(): Promise<void> {
    // Settle a pending prompt so the run's finally chain isn't left hanging.
    this.handleSubmit(null);
    this.store.update((state) => ({ ...state, closed: true }));
    // Commit a dangling live turn so an interrupted run still lands in scrollback.
    this.store.update((state) =>
      state.liveTurn
        ? {
            ...state,
            staticItems: [...state.staticItems, { kind: "turn", turn: state.liveTurn }],
            liveTurn: undefined,
          }
        : state,
    );
    // Give React/ink one beat to paint the final static items (the Done
    // line) — unmounting in the same tick drops them.
    await new Promise((resolve) => setTimeout(resolve, 20));
    this.instance.unmount();
  }

  private host(level: "info" | "success" | "warn" | "error", text: string): void {
    this.store.update((state) => ({
      ...state,
      staticItems: [...state.staticItems, { kind: "host", level, text }],
    }));
  }
}
