import { PlainRenderer } from "./plain.js";
import type { Renderer } from "./renderer.js";

export { PlainRenderer } from "./plain.js";
export type { Renderer } from "./renderer.js";

export type RenderMode = "plain" | "ink";

// Ink (and React) load only when actually rendering — plain runs and piped
// output never pay the import cost.
export async function createRenderer(mode: RenderMode): Promise<Renderer> {
  if (mode === "ink" && process.stdout.isTTY) {
    const { InkRenderer } = await import("./ink/InkRenderer.js");
    return new InkRenderer();
  }
  return new PlainRenderer();
}
