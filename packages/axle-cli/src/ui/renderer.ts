import type { Transcript, Turn, TurnEvent } from "@fifthrevision/axle/ui";

/** Cumulative run usage plus a rough estimate of the current context size. */
export interface SessionUsage {
  in: number;
  out: number;
  contextTokens: number;
  contextLimit?: number;
}

/**
 * Screen output boundary for the CLI.
 *
 * The transcript fold is pure logic owned by the runner: every event is
 * applied to the host `Transcript` before `onEvent` is called, so renderers
 * may consult the folded state instead of accumulating their own. Renderers
 * own the terminal; nothing else in the CLI writes to the screen. The render
 * mode is fixed at launch and never switched mid-run.
 */
export interface Renderer {
  /** Replay previously saved turns when resuming a session. */
  renderPriorTurns(turns: readonly Turn[]): void;
  /** Live turn event, already applied to the transcript. */
  onEvent(event: TurnEvent, transcript: Transcript): void;
  /** Host-level line outside any turn (session id, batch progress, totals). */
  info(message: string): void;
  /** Completion line (finished run, batch item done) — the ✔ gutter. */
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /**
   * Show the chat input line and resolve with the submitted text, or null
   * when the user ends the chat (Ctrl-C or Ctrl-D at the prompt).
   */
  promptInput(): Promise<string | null>;
  /** Refresh the persistent usage/context readout, where the renderer has one. */
  updateUsage(usage: SessionUsage): void;
  /**
   * Register the handler for a user interrupt (Ctrl-C during a turn). A
   * renderer that holds the terminal in raw mode receives Ctrl-C as a key
   * event — a real SIGINT would also hit ancestor processes (pnpm, tsx) and
   * kill the tree — so it must forward it here instead. Pass undefined to
   * unregister.
   */
  setInterruptHandler(handler: (() => void) | undefined): void;
  /** Called once when the run ends; flush and restore the terminal. */
  close(): void | Promise<void>;
}
