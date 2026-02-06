import braveSearchTool from "../tools/brave.js";
import calculatorTool from "../tools/calculator.js";
import execTool from "../tools/exec.js";
import readFromDiskTool from "../tools/read-from-disk.js";
import writeToDiskTool from "../tools/write-to-disk.js";
import type { Tool } from "../tools/types.js";
import type { ToolProviderConfig } from "./configs/schemas.js";

/**
 * Factory for creating Tool instances by name.
 * Tools are LLM-callable and require explicit input schemas.
 */
export function createTool(name: string, config?: ToolProviderConfig): Tool {
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
    case "read-from-disk": {
      return readFromDiskTool;
    }
    case "write-to-disk": {
      return writeToDiskTool;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * Create multiple tools by name.
 */
export function createTools(names: string[], config?: ToolProviderConfig): Tool[] {
  return names.map((name) => createTool(name, config));
}

/**
 * Available tool names for reference.
 */
export const availableTools = ["brave", "calculator", "exec", "read-from-disk", "write-to-disk"] as const;
export type AvailableToolName = (typeof availableTools)[number];
