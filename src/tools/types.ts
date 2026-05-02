import type { z, ZodObject } from "zod";
import type { ToolResultPart } from "../messages/message.js";
import type { TracingContext } from "../tracer/types.js";

export interface ToolContext {
  signal: AbortSignal;
  tracer?: TracingContext;
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
  config?: Record<string, unknown>;
}

export type ToolDefinition = Pick<ExecutableTool, "name" | "description" | "schema">;
