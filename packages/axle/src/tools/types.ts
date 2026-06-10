import type { z, ZodObject } from "zod";
import type { ToolResultPart } from "../messages/message.js";
import type { Span } from "../observability/types.js";
import type { TurnEvent } from "../turns/events.js";
import type { Stats } from "../types.js";
import type { ToolRegistry } from "./registry.js";

export type ToolProgressChunk =
  | string
  | {
      type: "turn-event";
      event: TurnEvent;
    };

export interface ToolContext {
  registry: ToolRegistry;
  signal: AbortSignal;
  emit: (chunk: ToolProgressChunk) => void;
  /**
   * Report model usage incurred while executing this tool (for example a
   * subagent's tokens) so it is rolled into the parent operation's totals.
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
