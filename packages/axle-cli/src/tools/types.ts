export type {
  ExecutableTool,
  ProviderTool,
  ToolContext,
  ToolDefinition,
} from "@fifthrevision/axle";

export interface BraveProviderConfig {
  "api-key": string;
  rateLimit?: number;
}

export interface ExecProviderConfig {
  timeout?: number;
  maxBuffer?: number;
  cwd?: string;
}

export interface ToolProviderConfig {
  brave?: BraveProviderConfig;
  exec?: ExecProviderConfig;
}
