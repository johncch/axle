import { z } from "zod";
import type { DeferredTool } from "../../../src/tools/types.js";

/** A deferred tool that accepts any arguments, so the stream consults `onToolCall` for it. */
export function deferredTool(name: string, timeout?: number): DeferredTool {
  return {
    type: "deferred",
    name,
    description: `deferred ${name}`,
    schema: z.looseObject({}),
    ...(timeout === undefined ? {} : { timeout }),
  };
}
