export type {
  ExecutableTool,
  ProviderTool,
  ToolContext,
  ToolDefinition,
} from "@fifthrevision/axle";

export interface ExecProviderConfig {
  timeout?: number;
  maxBuffer?: number;
  cwd?: string;
}

export interface ToolProviderConfig {
  exec?: ExecProviderConfig;
}
