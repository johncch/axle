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
}

/** A tool the model can call: run by the loop, or deferred to the caller. */
export type AnyTool = ExecutableTool | DeferredTool;
