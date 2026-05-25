import {
  braveSearchTool,
  calculatorTool,
  execTool,
  patchFileTool,
  readFileTool,
  writeFileTool,
  type ExecutableTool,
  type ToolProviderConfig,
} from "../tools/index.js";

/**
 * Factory for creating Tool instances by name.
 * Tools are LLM-callable and require explicit input schemas.
 */
export function createTool(name: string, config?: ToolProviderConfig): ExecutableTool {
  switch (name) {
    case "brave": {
      const toolConfig = config?.brave;
      if (toolConfig) {
        braveSearchTool.configure(toolConfig);
      }
      return braveSearchTool;
    }
    case "calculator": {
      return calculatorTool;
    }
    case "exec": {
      const toolConfig = config?.exec;
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
