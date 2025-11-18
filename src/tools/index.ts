import { default as braveSearchTool } from "./brave.js";
import { default as calculatorTool } from "./calculator.js";
import { default as execTool } from "./exec.js";
import { ToolRegistry } from "./registry.js";

let toolRegistry: ToolRegistry;

export function getToolRegistry() {
  if (!toolRegistry) {
    toolRegistry = new ToolRegistry();
    toolRegistry.register(calculatorTool);
    toolRegistry.register(braveSearchTool);
    toolRegistry.register(execTool);
  }
  return toolRegistry;
}

export * from "./types.js";
