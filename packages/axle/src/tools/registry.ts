import { AxleError } from "../errors/AxleError.js";
import type { ExecutableTool, ProviderTool } from "./types.js";

export class ToolRegistry {
  private tools = new Map<string, ExecutableTool>();
  private mcpTools = new Map<string, ExecutableTool>();
  private providerTools = new Map<string, ProviderTool>();

  constructor(init?: { tools?: ExecutableTool[]; providerTools?: ProviderTool[] }) {
    if (init?.tools) this.add(init.tools);
    if (init?.providerTools) this.addProvider(init.providerTools);
  }

  add(tool: ExecutableTool): void;
  add(tools: ExecutableTool[]): void;
  add(toolOrTools: ExecutableTool | ExecutableTool[]): void {
    const tools = Array.isArray(toolOrTools) ? toolOrTools : [toolOrTools];
    for (const tool of tools) {
      if (this.has(tool.name)) {
        throw new AxleError(`Tool already registered: ${tool.name}`, {
          code: "TOOL_REGISTRY_DUPLICATE",
          details: { name: tool.name },
        });
      }
      this.tools.set(tool.name, tool);
    }
  }

  addMcp(tool: ExecutableTool): void;
  addMcp(tools: ExecutableTool[]): void;
  addMcp(toolOrTools: ExecutableTool | ExecutableTool[]): void {
    const tools = Array.isArray(toolOrTools) ? toolOrTools : [toolOrTools];
    for (const tool of tools) {
      if (this.has(tool.name)) {
        throw new AxleError(`Tool already registered: ${tool.name}`, {
          code: "TOOL_REGISTRY_DUPLICATE",
          details: { name: tool.name },
        });
      }
      this.mcpTools.set(tool.name, tool);
    }
  }

  addProvider(tool: ProviderTool): void;
  addProvider(tools: ProviderTool[]): void;
  addProvider(toolOrTools: ProviderTool | ProviderTool[]): void {
    const tools = Array.isArray(toolOrTools) ? toolOrTools : [toolOrTools];
    for (const tool of tools) {
      if (this.has(tool.name)) {
        throw new AxleError(`Tool already registered: ${tool.name}`, {
          code: "TOOL_REGISTRY_DUPLICATE",
          details: { name: tool.name },
        });
      }
      this.providerTools.set(tool.name, tool);
    }
  }

  remove(name: string): boolean {
    const removedTool = this.tools.delete(name);
    const removedMcp = this.mcpTools.delete(name);
    const removedProvider = this.providerTools.delete(name);
    return removedTool || removedMcp || removedProvider;
  }

  has(name: string): boolean {
    return this.tools.has(name) || this.mcpTools.has(name) || this.providerTools.has(name);
  }

  get(name: string): ExecutableTool | undefined {
    return this.tools.get(name) ?? this.mcpTools.get(name);
  }

  getProvider(name: string): ProviderTool | undefined {
    return this.providerTools.get(name);
  }

  executable(): ExecutableTool[] {
    return [...this.tools.values(), ...this.mcpTools.values()];
  }

  local(): ExecutableTool[] {
    return [...this.tools.values()];
  }

  mcp(): ExecutableTool[] {
    return [...this.mcpTools.values()];
  }

  provider(): ProviderTool[] {
    return [...this.providerTools.values()];
  }

  get size(): number {
    return this.tools.size + this.mcpTools.size + this.providerTools.size;
  }
}
