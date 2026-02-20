import type { z, ZodObject } from "zod";
import type { ToolResultPart } from "../messages/message.js";

export interface Tool<TSchema extends ZodObject<any> = ZodObject<any>> {
  name: string;
  description: string;
  schema: TSchema;
  execute(input: z.infer<TSchema>): Promise<string | ToolResultPart[]>;
  configure?(config: Record<string, any>): void;
  summarize?(input: z.infer<TSchema>): string;
}

export type ToolDefinition = Pick<Tool, "name" | "description" | "schema">;
