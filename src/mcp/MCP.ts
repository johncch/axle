import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool, ToolDefinition } from "../tools/types.js";
import type { TracingContext } from "../tracer/types.js";
import { createMcpToolDefinitions, createMcpTools } from "./tools.js";

export interface MCPStdioConfig {
  transport: "stdio";
  name?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface MCPHttpConfig {
  transport: "http";
  name?: string;
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

  get name(): string | undefined {
    return this.config.name ?? this.client?.getServerVersion()?.name;
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(options?: { tracer?: TracingContext }): Promise<void> {
    if (this._connected) return;

    const span = options?.tracer?.startSpan("mcp:connect", { type: "internal" });

    this.client = new Client({ name: "axle", version: "1.0.0" });

    if (this.config.transport === "stdio") {
      this.transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args,
        env: this.config.env,
      });
    } else {
      this.transport = new StreamableHTTPClientTransport(new URL(this.config.url), {
        requestInit: this.config.headers ? { headers: this.config.headers } : undefined,
      });
    }

    try {
      await this.client.connect(this.transport);
      this._connected = true;
      span?.end("ok");
    } catch (error) {
      span?.end("error");
      throw error;
    }
  }

  async listTools(options?: { prefix?: string; tracer?: TracingContext }): Promise<Tool[]> {
    const client = this.assertConnected();
    const mcpTools = await this.fetchTools(client, options?.tracer);
    return createMcpTools(mcpTools, client, options?.prefix);
  }

  async listToolDefinitions(options?: {
    prefix?: string;
    tracer?: TracingContext;
  }): Promise<ToolDefinition[]> {
    const client = this.assertConnected();
    const mcpTools = await this.fetchTools(client, options?.tracer);
    return createMcpToolDefinitions(mcpTools, options?.prefix);
  }

  async refreshTools(): Promise<Tool[]> {
    this.assertConnected();
    this.cachedMcpTools = undefined;
    return this.listTools();
  }

  async close(options?: { tracer?: TracingContext }): Promise<void> {
    if (!this._connected) return;
    options?.tracer?.debug("mcp:close");
    await this.client?.close();
    this._connected = false;
    this.client = undefined;
    this.transport = undefined;
    this.cachedMcpTools = undefined;
  }

  private async fetchTools(client: Client, tracer?: TracingContext): Promise<McpToolInfo[]> {
    if (this.cachedMcpTools) return this.cachedMcpTools;

    tracer?.debug("mcp:listTools");
    const result = await client.listTools();
    this.cachedMcpTools = result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
    return this.cachedMcpTools;
  }

  private assertConnected(): Client {
    if (!this._connected || !this.client) {
      throw new Error("MCP not connected. Call connect() first.");
    }
    return this.client;
  }
}
