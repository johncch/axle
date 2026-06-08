import type { z, ZodObject } from "zod";
import type { ToolResultPart } from "../messages/message.js";
import type { Span } from "../observability/types.js";
import type { ToolRegistry } from "./registry.js";

export interface ToolContext {
  registry: ToolRegistry;
  signal: AbortSignal;
  emit: (chunk: string) => void;
  span?: Span;
}

export interface ExecutableTool<TSchema extends ZodObject<any> = ZodObject<any>> {
  type?: "function";
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
