import { ZodObject } from "zod";

export interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, object>;
    required: string[];
  };
}

export interface ToolExecutable {
  name: string;
  schema: ToolSchema;
  setConfig?: (config: { [key: string]: any }) => void;
  execute: (params: { [key: string]: any }) => Promise<string>;
}

export interface ToolConstructor<T extends ToolExecutable = ToolExecutable> {
  new (...args: any[]): T;
}

export type ToolDef<Z extends ZodObject = ZodObject> = {
  name: string;
  description?: string;
  schema: Z;
};
