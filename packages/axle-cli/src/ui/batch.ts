/** Running totals for a batch, shown in the progress renderer's footer. */
export interface BatchTotals {
  total: number;
  completed: number;
  skipped: number;
  failed: number;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Live-progress hooks for a batch run — a progress fold, not transcripts.
 * Settled item lines and the summary still arrive as host lines on the
 * `Renderer`; these hooks only drive the in-flight rows and totals.
 */
export interface BatchProgress {
  batchStarted(totals: BatchTotals): void;
  itemStarted(input: string): void;
  /** Cheap status folded from the item's turn events ("Thinking", tool name, "Writing"). */
  itemPhase(input: string, phase: string): void;
  itemFinished(input: string, totals: BatchTotals): void;
}

export function supportsBatchProgress(value: unknown): value is BatchProgress {
  return typeof value === "object" && value !== null && "itemStarted" in value;
}
