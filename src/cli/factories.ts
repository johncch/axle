import { WriteToDisk } from "../actions/writeToDisk.js";
import braveSearchTool from "../tools/brave.js";
import calculatorTool from "../tools/calculator.js";
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
 * Factory for creating Action instances.
 * Actions are workflow-callable steps executed between LLM calls.
 */
export function createWriteToDiskAction(
  pathTemplate: string,
  contentTemplate: string = "{{response}}",
): WriteToDisk {
  return new WriteToDisk(pathTemplate, contentTemplate);
}

/**
 * Available tool names for reference.
 */
export const availableTools = ["brave", "calculator"] as const;
export type AvailableToolName = (typeof availableTools)[number];
