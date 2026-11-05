import type { z } from "zod";
import type { DeferredAction, TurnPart } from "../turns/types.js";
import type { DeferredCall, DeferredTool } from "./types.js";

/** A `DeferredCall` whose `input` is typed by the tool's schema. */
export type DeferredCallOf<T extends DeferredTool> = DeferredCall<z.infer<T["schema"]>>;

/** A `DeferredAction` whose `detail.input` is typed by the tool's schema. */
export type DeferredActionOf<T extends DeferredTool> = Omit<DeferredAction, "detail"> & {
  detail: Omit<DeferredAction["detail"], "input"> & { input: z.infer<T["schema"]> };
};

/**
 * Narrows a call inside an `onToolCall` handler to one tool. The input was
 * validated against that tool's schema before the handler ran, so the check
 * is the name alone.
 */
export function isCall<T extends DeferredTool>(
  tool: T,
  call: DeferredCall,
): call is DeferredCallOf<T> {
  return call.name === tool.name;
}

/**
 * Narrows a turn part to the deferred action of one tool, once its input is
 * in: a `pending` part has none yet and is excluded.
 */
export function isActionOf<T extends DeferredTool>(
  tool: T,
  part: TurnPart,
): part is DeferredActionOf<T> {
  return (
    part.type === "action" &&
    part.kind === "deferred" &&
    part.detail.name === tool.name &&
    part.status !== "pending"
  );
}
