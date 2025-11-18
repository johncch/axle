import { ServiceConfig } from "../cli/configs/schemas.js";
import { ToolExecutable } from "./types.js";

type ToolProviderConfig = Pick<ServiceConfig, "brave">;

export class ToolRegistry {
  private executables: Record<string, ToolExecutable> = {};
  private config: ToolProviderConfig;

  setConfig(config: ToolProviderConfig) {
    this.config = config;
  }

  register(tool: ToolExecutable): void {
    if (this.executables[tool.name]) {
      throw new Error(`Tool with name '${tool.name}' is already registered`);
    }

    this.executables[tool.name] = tool;
  }

  get(name: string): ToolExecutable {
    const tool = this.executables[name];
    if (!tool) {
      throw new Error(`Tool '${name}' is not registered`);
    }
    tool.setConfig?.(this.config[name]);
    return tool;
  }
}
