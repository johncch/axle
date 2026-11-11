import type { Transcript, Turn, TurnEvent } from "@fifthrevision/axle/ui";
import { render } from "ink";
import type { ChatInput, Renderer, SessionUsage } from "../renderer.js";
import { App } from "./App.js";
import type { StaticItem, UiState } from "./store.js";
import { createCommitLog, partitionTurns, UiStore } from "./store.js";

/**
 * Ink terminal-flow renderer: runner lines, finished turns and the settled
 * parts of the in-flight turn commit to scrollback via `<Static>`; a live
 * region shows what is still changing (the open text block, running actions)
 * with a spinner. The chat input line
 * renders inside the app while a prompt is pending.
 */
export class InkRenderer implements Renderer {
  readonly acceptsInputDuringTurn = true;
  private store = new UiStore<UiState>({
    staticItems: [],
    pending: [],
    awaitingInput: false,
    queuedInputs: [],
  });
  private commitLog = createCommitLog();
  private instance: ReturnType<typeof render>;
  private waiter?: (value: ChatInput | null) => void;

  constructor(options?: { statusBar?: boolean; userMessageBackground?: string }) {
    this.instance = render(
      <App
        store={this.store}
        onSubmit={this.handleSubmit}
        statusBar={options?.statusBar ?? true}
        userMessageBackground={options?.userMessageBackground}
      />,
      {
        exitOnCtrlC: false,
        patchConsole: false,
        maxFps: 60,
        kittyKeyboard: { mode: "auto" },
      },
    );
  }

  private handleSubmit = (value: ChatInput | null): void => {
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
    for (const turn of turns) this.commitLog.finished.add(turn.id);
    this.store.update((state) => ({
      ...state,
      staticItems: [...state.staticItems, ...items],
    }));
  }

  onEvent(_event: TurnEvent, transcript: Transcript): void {
    const { commits, liveTurn, liveContinues } = partitionTurns(transcript.turns, this.commitLog);

    this.store.update((state) => ({
      ...state,
      staticItems: commits.length ? [...state.staticItems, ...commits] : state.staticItems,
      liveTurn,
      liveContinues,
      pending: transcript.pending,
    }));
  }

  info(message: string): void {
    this.runnerLine("info", message);
  }

  success(message: string): void {
    this.runnerLine("success", message);
  }

  warn(message: string): void {
    this.runnerLine("warn", message);
  }

  error(message: string): void {
    this.runnerLine("error", message);
  }

  updateUsage(usage: SessionUsage): void {
    this.store.update((state) => ({ ...state, usage }));
  }

  setInterruptHandler(handler: (() => void) | undefined): void {
    this.store.update((state) => ({ ...state, onInterrupt: handler }));
  }

  setImageInput(accepted: boolean): void {
    this.store.update((state) => ({ ...state, imageInput: accepted }));
  }

  promptInput(): Promise<ChatInput | null> {
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
            staticItems: [
              ...state.staticItems,
              { kind: "turn", turn: state.liveTurn, continues: state.liveContinues },
            ],
            liveTurn: undefined,
            liveContinues: false,
          }
        : state,
    );
    // Give React/ink one beat to paint the final static items (the Done
    // line) — unmounting in the same tick drops them.
    await new Promise((resolve) => setTimeout(resolve, 20));
    this.instance.unmount();
  }

  private runnerLine(level: "info" | "success" | "warn" | "error", text: string): void {
    this.store.update((state) => ({
      ...state,
      staticItems: [...state.staticItems, { kind: "runner", level, text }],
    }));
  }
}
