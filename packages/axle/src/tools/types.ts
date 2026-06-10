import type { z, ZodObject } from "zod";
import type { ToolResultPart } from "../messages/message.js";
import type { Span } from "../observability/types.js";
import type { TurnEvent } from "../turns/events.js";
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
  span?: Span;
}

export interface ToolExecutionOptions<TInput = unknown> {
  /**
   * Whether independent calls to this tool may run concurrently when a provider
   * emits multiple tool calls in the same model turn.
   */
  parallel?: boolean;
  /** Maximum concurrent calls for this tool. Omit for no tool-specific cap. */
  maxConcurrency?: number;
  /**
   * Optional conflict key used to prevent calls that touch the same resource
   * from running at the same time. For example, file write tools can key by path.
   */
  conflictKey?: (input: TInput) => string | undefined;
}

export interface ExecutableTool<TSchema extends ZodObject<any> = ZodObject<any>> {
  type?: "function";
  kind?: "tool" | "agent";
  name: string;
  description: string;
  schema: TSchema;
  execute(input: z.infer<TSchema>, ctx: ToolContext): Promise<string | ToolResultPart[]>;
  execution?: ToolExecutionOptions<z.infer<TSchema>>;
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
