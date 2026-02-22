import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ToolResultPart } from "../messages/message.js";
import type { ExecutableTool, ToolDefinition } from "../tools/types.js";
import { jsonSchemaToZod } from "./schema.js";

interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Convert MCP tools into Axle Tool objects that proxy execute() to the MCP server.
 */
export function createMcpTools(
  mcpTools: McpToolInfo[],
  client: Client,
  prefix?: string,
): ExecutableTool[] {
  return mcpTools.map((mcpTool) => createMcpTool(mcpTool, client, prefix));
}

/**
 * Convert MCP tools into Axle ToolDefinition objects (schema only, no execute).
 */
export function createMcpToolDefinitions(
  mcpTools: McpToolInfo[],
  prefix?: string,
): ToolDefinition[] {
  return mcpTools.map((mcpTool) => {
    const name = prefix ? `${prefix}_${mcpTool.name}` : mcpTool.name;
    const schema = jsonSchemaToZod(mcpTool.inputSchema);
    return { name, description: mcpTool.description ?? "", schema };
  });
}

function createMcpTool(mcpTool: McpToolInfo, client: Client, prefix?: string): ExecutableTool {
  const name = prefix ? `${prefix}_${mcpTool.name}` : mcpTool.name;
  const schema = jsonSchemaToZod(mcpTool.inputSchema);

  return {
    name,
    description: mcpTool.description ?? "",
    schema,

    async execute(input): Promise<string | ToolResultPart[]> {
      const result = await client.callTool({
        name: mcpTool.name, // always use original name with server
        arguments: input,
      });

      if ("isError" in result && result.isError) {
        throw new Error(formatErrorContent(result.content as McpContent[]));
      }

      return formatToolResult(result.content as McpContent[]);
    },
  };
}

type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; text?: string; blob?: string } };

function formatToolResult(content: McpContent[]): string | ToolResultPart[] {
  const hasImages = content.some((c) => c.type === "image");

  if (!hasImages) {
    // Text-only — return as plain string for backward compatibility
    return content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("\n");
  }

  // Mixed content — return as ToolResultPart[]
  return content
    .filter((c) => c.type === "text" || c.type === "image")
    .map((c) => {
      if (c.type === "text") {
        return { type: "text" as const, text: c.text };
      }
      const img = c as { type: "image"; data: string; mimeType: string };
      return { type: "image" as const, data: img.data, mimeType: img.mimeType };
    });
}

function formatErrorContent(content: McpContent[]): string {
  return (
    content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("\n") || "MCP tool execution error"
  );
}
