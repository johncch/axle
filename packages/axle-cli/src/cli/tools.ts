import {
  execTool,
  helpTool,
  patchFileTool,
  readFileTool,
  writeFileTool,
  type ExecutableTool,
} from "../tools/index.js";

/**
 * Factory for creating Tool instances by name.
 * Tools are LLM-callable and require explicit input schemas.
 */
export function createTool(name: string): ExecutableTool {
  switch (name) {
    case "exec": {
      return execTool;
    }
    case "axle-help": {
      return helpTool;
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
export function createTools(names: string[]): ExecutableTool[] {
  return names.map((name) => createTool(name));
}

/**
 * Available tool names for reference.
 */
export const availableTools = [
  "axle-help",
  "exec",
  "patch-file",
  "read-file",
  "write-file",
] as const;
export type AvailableToolName = (typeof availableTools)[number];

export const defaultToolNames: readonly AvailableToolName[] = availableTools;

const TOOLS_NEEDING_TRUST: ReadonlySet<string> = new Set<AvailableToolName>([
  "exec",
  "patch-file",
  "write-file",
]);

/**
 * Splits a tool list into the tools an untrusted folder may run and the
 * ones it may not: those that execute, write, or patch act on the folder.
 */
export function partitionByTrust(names: string[]): { kept: string[]; dropped: string[] } {
  return {
    kept: names.filter((name) => !TOOLS_NEEDING_TRUST.has(name)),
    dropped: names.filter((name) => TOOLS_NEEDING_TRUST.has(name)),
  };
}
