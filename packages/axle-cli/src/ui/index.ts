import { PlainRenderer } from "./plain.js";
import type { Renderer } from "./renderer.js";

export type { BatchProgress, BatchTotals } from "./batch.js";
export { supportsBatchProgress } from "./batch.js";
export { PlainRenderer } from "./plain.js";
export type { Renderer, SessionUsage } from "./renderer.js";

export type RenderMode = "plain" | "ink";

// Ink (and React) load only when actually rendering — plain runs and piped
// output never pay the import cost. Ink needs stdin as a TTY too: raw mode
// throws on piped stdin.
export async function createRenderer(
  mode: RenderMode,
  options?: { batchProgress?: boolean },
): Promise<Renderer> {
  if (mode === "ink" && process.stdout.isTTY && process.stdin.isTTY) {
    if (options?.batchProgress) {
      const { InkBatchRenderer } = await import("./ink/InkBatchRenderer.js");
      return new InkBatchRenderer();
    }
    const { InkRenderer } = await import("./ink/InkRenderer.js");
    return new InkRenderer();
  }
  return new PlainRenderer();
}
