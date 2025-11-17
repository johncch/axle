import { z, ZodObject } from "zod";
import { Executable, ExecutableContext } from "../types.js";

export type ToolDefinition<Z extends ZodObject = ZodObject> = {
  name: string;
  description?: string;
  schema: Z;
};

export interface ToolExecutable<Z extends ZodObject = ZodObject>
  extends Executable<z.infer<Z>, string> {
  setConfig?: (config: { [key: string]: any }) => void;
  // Inherited from Executable: execute(params: z.infer<Z>, context: ExecutableContext): Promise<string>
}

export interface ToolConstructor<T extends ToolExecutable = ToolExecutable> {
  new (...args: any[]): T;
}
