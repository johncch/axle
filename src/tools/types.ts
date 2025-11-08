import { z, ZodObject } from "zod";

export type ToolDefinition<Z extends ZodObject = ZodObject> = {
  name: string;
  description?: string;
  schema: Z;
};

export interface ToolExecutable<Z extends ZodObject = ZodObject> extends ToolDefinition<Z> {
  setConfig?: (config: { [key: string]: any }) => void;
  execute: (params: z.infer<Z>) => Promise<string>;
}

export interface ToolConstructor<T extends ToolExecutable = ToolExecutable> {
  new (...args: any[]): T;
}
