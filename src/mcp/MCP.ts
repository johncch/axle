import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "../tools/types.js";
import type { ToolDefinition } from "../tools/types.js";
import { createMcpToolDefinitions, createMcpTools } from "./tools.js";

export interface MCPStdioConfig {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface MCPHttpConfig {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
}

export type MCPConfig = MCPStdioConfig | MCPHttpConfig;

interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export class MCP {
  private config: MCPConfig;
  private client: Client | undefined;
  private transport: StdioClientTransport | StreamableHTTPClientTransport | undefined;
  private cachedMcpTools: McpToolInfo[] | undefined;
  private _connected = false;

  constructor(config: MCPConfig) {
    this.config = config;
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    if (this._connected) return;

    this.client = new Client({ name: "axle", version: "1.0.0" });

    if (this.config.transport === "stdio") {
      this.transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args,
        env: this.config.env,
      });
    } else {
      this.transport = new StreamableHTTPClientTransport(new URL(this.config.url), {
        requestInit: this.config.headers
          ? { headers: this.config.headers }
          : undefined,
      });
    }

    await this.client.connect(this.transport);
    this._connected = true;
  }

  async listTools(options?: { prefix?: string }): Promise<Tool[]> {
    this.assertConnected();
    const mcpTools = await this.fetchTools();
    return createMcpTools(mcpTools, this.client!, options?.prefix);
  }

  async listToolDefinitions(options?: { prefix?: string }): Promise<ToolDefinition[]> {
    this.assertConnected();
    const mcpTools = await this.fetchTools();
    return createMcpToolDefinitions(mcpTools, options?.prefix);
  }

  async refreshTools(): Promise<Tool[]> {
    this.assertConnected();
    this.cachedMcpTools = undefined;
    return this.listTools();
  }

  async close(): Promise<void> {
    if (!this._connected) return;
    await this.client?.close();
    this._connected = false;
    this.client = undefined;
    this.transport = undefined;
    this.cachedMcpTools = undefined;
  }

  private async fetchTools(): Promise<McpToolInfo[]> {
    if (this.cachedMcpTools) return this.cachedMcpTools;

    const result = await this.client!.listTools();
    this.cachedMcpTools = result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
    return this.cachedMcpTools;
  }

  private assertConnected(): asserts this is { client: Client } {
    if (!this._connected || !this.client) {
      throw new Error("MCP not connected. Call connect() first.");
    }
  }
}
