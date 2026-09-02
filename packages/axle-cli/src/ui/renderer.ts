import type { Transcript, Turn, TurnEvent } from "@fifthrevision/axle/ui";

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
  warn(message: string): void;
  error(message: string): void;
  /** Called once when the run ends; flush and restore the terminal. */
  close(): void;
}
