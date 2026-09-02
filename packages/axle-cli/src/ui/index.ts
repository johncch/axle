import { PlainRenderer } from "./plain.js";
import type { Renderer } from "./renderer.js";

export type { Renderer } from "./renderer.js";
export { PlainRenderer } from "./plain.js";

export type RenderMode = "plain";

export function createRenderer(mode: RenderMode): Renderer {
  switch (mode) {
    case "plain":
      return new PlainRenderer();
  }
}
