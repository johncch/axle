import type { z, ZodObject } from "zod";
import type { ToolResultPart } from "../messages/message.js";

export interface ExecutableTool<TSchema extends ZodObject<any> = ZodObject<any>> {
  type?: "function";
  name: string;
  description: string;
  schema: TSchema;
  execute(input: z.infer<TSchema>): Promise<string | ToolResultPart[]>;
  configure?(config: Record<string, any>): void;
  summarize?(input: z.infer<TSchema>): string;
}

export interface ServerTool {
  type: "server";
  name: string;
  config?: Record<string, unknown>;
}

export type AxleTool = ExecutableTool | ServerTool;

export type ToolDefinition = Pick<ExecutableTool, "name" | "description" | "schema">;
