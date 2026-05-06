import { AxleError } from "../errors/AxleError.js";
import type { ExecutableTool, ProviderTool } from "./types.js";

export class ToolRegistry {
  private executableTools = new Map<string, ExecutableTool>();
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
      this.executableTools.set(tool.name, tool);
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
    return this.executableTools.delete(name) || this.providerTools.delete(name);
  }

  has(name: string): boolean {
    return this.executableTools.has(name) || this.providerTools.has(name);
  }

  get(name: string): ExecutableTool | undefined {
    return this.executableTools.get(name);
  }

  getProvider(name: string): ProviderTool | undefined {
    return this.providerTools.get(name);
  }

  executable(): ExecutableTool[] {
    return [...this.executableTools.values()];
  }

  provider(): ProviderTool[] {
    return [...this.providerTools.values()];
  }

  get size(): number {
    return this.executableTools.size + this.providerTools.size;
  }
}
