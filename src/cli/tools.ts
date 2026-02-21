import braveSearchTool from "../tools/brave.js";
import calculatorTool from "../tools/calculator.js";
import execTool from "../tools/exec/index.js";
import patchFileTool from "../tools/patch-file.js";
import readFileTool from "../tools/read-file.js";
import type { ExecutableTool } from "../tools/types.js";
import writeFileTool from "../tools/write-file.js";
import type { ToolProviderConfig } from "./configs/schemas.js";

/**
 * Factory for creating Tool instances by name.
 * Tools are LLM-callable and require explicit input schemas.
 */
export function createTool(name: string, config?: ToolProviderConfig): ExecutableTool {
  const toolConfig = config?.[name];

  switch (name) {
    case "brave": {
      if (toolConfig) {
        braveSearchTool.configure(toolConfig);
      }
      return braveSearchTool;
    }
    case "calculator": {
      return calculatorTool;
    }
    case "exec": {
      if (toolConfig) {
        execTool.configure(toolConfig);
      }
      return execTool;
    }
    case "patch-file": {
      return patchFileTool;
    }
    case "read-file": {
      return readFileTool;
    }
    case "write-file": {
      return writeFileTool;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * Create multiple tools by name.
 */
export function createTools(names: string[], config?: ToolProviderConfig): ExecutableTool[] {
  return names.map((name) => createTool(name, config));
}

/**
 * Available tool names for reference.
 */
export const availableTools = [
  "brave",
  "calculator",
  "exec",
  "patch-file",
  "read-file",
  "write-file",
] as const;
export type AvailableToolName = (typeof availableTools)[number];
