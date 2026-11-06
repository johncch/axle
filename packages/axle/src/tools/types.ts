import type { z, ZodObject } from "zod";
import type { ToolResultPart } from "../messages/message.js";
import type { Span } from "../observability/types.js";
import type { TurnEvent } from "../turns/events.js";
import type { Stats } from "../types.js";

export type ToolProgressChunk =
  | string
  | {
      type: "turn-event";
      event: TurnEvent;
    };

export interface ToolContext {
  signal: AbortSignal;
  emit: (chunk: ToolProgressChunk) => void;
  /**
   * Report model usage incurred while executing this tool (for example a
   * subagent's tokens) so it is rolled into the parent operation's totals.
   *
   * @experimental
   */
  reportUsage?: (usage: Stats) => void;
  span?: Span;
}

export interface ExecutableTool<TSchema extends ZodObject<any> = ZodObject<any>> {
  type?: "function";
  /** Presentation metadata. Agent-backed tools set "agent"; execution is identical. */
  kind?: "tool" | "agent";
  name: string;
  description: string;
  schema: TSchema;
  execute(input: z.infer<TSchema>, ctx: ToolContext): Promise<string | ToolResultPart[]>;
  configure?(config: Record<string, any>): void;
  summarize?(input: z.infer<TSchema>): string;
}

export interface ProviderTool {
  type: "provider";
  name: string;
  /** Provider-specific passthrough config. Field names and placement are not portable. */
  config?: Record<string, unknown>;
}

export type ToolDefinition = Pick<ExecutableTool, "name" | "description" | "schema">;

/**
 * A tool the model can call but the loop cannot run: a definition with no
 * `execute`. The caller's `onToolCall` callback answers it with the same
 * result an `execute` would return. Zod only, so the same definition is
 * importable on both sides of a network boundary.
 */
export interface DeferredTool<TSchema extends ZodObject<any> = ZodObject<any>> {
  type: "deferred";
  name: string;
  description: string;
  schema: TSchema;
  summarize?(input: z.infer<TSchema>): string;
  /** Milliseconds a call may wait for its answer before it fails with `timeout`. Unbounded when absent. */
  timeout?: number;
}

/** One call to a deferred tool, with its arguments already validated against the tool's schema. */
export interface DeferredCall<TInput = Record<string, unknown>> {
  id: string;
  name: string;
  input: TInput;
}

/**
 * Answers deferred calls. The contract is `execute`'s: return the result, or
 * throw to give the model an error with a reason. Returning nothing means
 * this handler does not answer the call: it stays waiting for `toolCall(id)`,
 * the tool's `timeout` or the run's cancellation. `ctx.signal` aborts when the
 * call settles without this handler's answer; what the handler resolves to
 * after that is dropped.
 */
export type ToolCallCallback = (
  call: DeferredCall,
  ctx: ToolContext,
) => string | ToolResultPart[] | void | Promise<string | ToolResultPart[] | void>;

/**
 * A deferred call the loop is waiting on, reached through `toolCall(id)` on
 * a stream handle or an `Agent`. `answer` settles it with a result and `fail`
 * with an `execution` error carrying the message, the two outcomes a handler
 * has. The first settle wins; a later one does nothing.
 */
export interface WaitingToolCall {
  answer(content: string | ToolResultPart[]): void;
  fail(message: string): void;
}

/** A tool the model can call: run by the loop, or deferred to the caller. */
export type AnyTool = ExecutableTool | DeferredTool;
