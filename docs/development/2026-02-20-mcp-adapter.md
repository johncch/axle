# MCP Adapter Design

**Date:** 2026-02-20
**Status:** Draft

## Overview

Add an MCP (Model Context Protocol) adapter to Axle that allows Agents to use tools
provided by any MCP server. The adapter connects to an MCP server, discovers its
tools, and wraps them as Axle `Tool` objects that integrate seamlessly with the
existing Agent and provider infrastructure.

## Goals

- Connect to MCP servers via **stdio** and **streamable HTTP** transports
- Convert MCP tools into Axle `Tool` objects
- Work transparently with existing `Agent`, `generate()`, and `stream()` APIs
- No changes required to providers or core types
- Designed for future extensibility (resources, prompts)

## Non-Goals (for now)

- MCP resources (data sources)
- MCP prompts (reusable templates)
- MCP sampling (server-initiated LLM requests)
- CLI config integration (YAML `services.mcp` section)

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ Agent                                               │
│   tools: Tool[]  ← local tools + MCP tools          │
│   provider: AIProvider                              │
└────────────┬────────────────────────────────────────┘
             │ tool.execute(params)
             ▼
┌──────────────────────┐    ┌──────────────────────┐
│ Local Tool           │    │ MCP Tool (proxy)     │
│ schema: Zod          │    │ schema: Zod          │
│ execute() → local fn │    │ execute() → callTool │
└──────────────────────┘    └─────────┬────────────┘
                                      │ JSON-RPC
                                      ▼
                            ┌──────────────────────┐
                            │ MCP Server           │
                            │ (stdio or HTTP)      │
                            └──────────────────────┘
```

MCP tools are indistinguishable from local tools to the Agent. The only difference
is that `execute()` proxies the call to the MCP server via the SDK client.

## API Design

### Connecting to an MCP server

```ts
import { connectMcp } from "@fifthrevision/axle";

// Stdio transport — spawn a child process
const mcp = await connectMcp({
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"],
});

// Streamable HTTP transport — connect to a remote server
const mcp = await connectMcp({
  transport: "http",
  url: "http://localhost:3000/mcp",
  headers: { Authorization: "Bearer ..." },
});
```

### Getting tools

```ts
const tools = await mcp.listTools();
// tools: Tool[] — standard Axle tools, ready to use
```

### Using with Agent

```ts
import { Agent, anthropic, connectMcp } from "@fifthrevision/axle";

const mcp = await connectMcp({
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"],
});

const mcpTools = await mcp.listTools();

const agent = new Agent({
  provider: anthropic(apiKey),
  model: "claude-sonnet-4-20250514",
  tools: [...localTools, ...mcpTools],
});

const result = await agent.send("List files in the home directory").final;

// Clean up when done
await mcp.close();
```

### Multiple MCP servers

```ts
const fsMcp = await connectMcp({
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"],
});

const gitMcp = await connectMcp({
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
});

const agent = new Agent({
  provider: anthropic(apiKey),
  model: "claude-sonnet-4-20250514",
  tools: [...await fsMcp.listTools(), ...await gitMcp.listTools()],
});

// Clean up
await fsMcp.close();
await gitMcp.close();
```

### Tool name prefixing (optional)

If tools from different servers collide, callers can add a prefix:

```ts
const tools = await mcp.listTools({ prefix: "fs" });
// tool names: "fs_read_file", "fs_write_file", etc.
```

## Type Definitions

```ts
// --- Config ---

interface McpStdioConfig {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpHttpConfig {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
}

type McpConfig = McpStdioConfig | McpHttpConfig;

// --- Connection ---

interface McpConnection {
  /** List tools from the MCP server, converted to Axle Tool objects. */
  listTools(options?: { prefix?: string }): Promise<Tool[]>;

  /** Close the connection and clean up resources. */
  close(): Promise<void>;
}
```

## JSON Schema → Zod Conversion

MCP tools define their input schemas as JSON Schema objects. Axle tools require
Zod schemas. The providers then convert Zod schemas back to JSON Schema via
`z.toJSONSchema()` when sending tool definitions to LLM APIs.

**Strategy:** Use Zod 4's built-in `z.fromJSONSchema()` for the conversion.

```
MCP Server                    Axle                        LLM API
inputSchema ──────────→ z.fromJSONSchema() ──────────→ z.toJSONSchema()
(JSON Schema)            (Zod schema)                  (JSON Schema)
```

The round-trip (JSON Schema → Zod → JSON Schema) is not guaranteed to be 1:1 by
Zod, but for the types MCP tools typically use (objects with string/number/boolean/
array properties, enums, optional fields), the conversion is reliable.

**Fallback:** If `z.fromJSONSchema()` fails for a particular tool schema (e.g.,
unsupported JSON Schema features), fall back to `z.object({}).passthrough()` and
log a warning. The MCP server performs its own validation, so loose Zod validation
is acceptable — the schema mainly exists to inform the LLM about the expected shape.

## MCP Tool → Axle Tool Mapping

Each MCP tool becomes an Axle `Tool` object:

```ts
function createMcpTool(
  mcpTool: McpToolDefinition,
  client: McpClient,
  prefix?: string,
): Tool {
  const name = prefix ? `${prefix}_${mcpTool.name}` : mcpTool.name;
  const schema = convertSchema(mcpTool.inputSchema);

  return {
    name,
    description: mcpTool.description ?? "",
    schema,

    async execute(input) {
      const result = await client.callTool({
        name: mcpTool.name,  // always use original name with server
        arguments: input,
      });
      return formatToolResult(result);
    },
  };
}
```

### Result formatting

MCP `tools/call` returns a result with `content` (array of text/image/resource
blocks) and `isError` flag. We need to convert this to a string for Axle:

- **Text content:** Concatenate all text blocks
- **Image content:** Return a description placeholder (images in tool results
  aren't supported in Axle's tool result format today)
- **Error results:** Throw an Error so the existing tool error handling in
  `executeToolCalls()` catches it

## File Structure

```
src/mcp/
├── index.ts           # Public API: connectMcp, types
├── connection.ts      # McpConnection implementation
├── tools.ts           # MCP tool → Axle tool conversion
└── schema.ts          # JSON Schema → Zod conversion utilities
```

## Dependencies

- `@modelcontextprotocol/sdk` — Official MCP TypeScript SDK (new dependency)
  - Provides `Client`, `StdioClientTransport`, `StreamableHTTPClientTransport`
  - Handles JSON-RPC protocol, transport negotiation, capability exchange

No other new dependencies needed. `z.fromJSONSchema()` is built into Zod 4.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| MCP server fails to start | `connectMcp()` throws with descriptive error |
| MCP server crashes mid-session | `tool.execute()` throws, Agent handles via tool error flow |
| Tool not found on server | MCP SDK throws, wrapped as tool execution error |
| Schema conversion fails | Warning logged, fall back to permissive schema |
| Connection already closed | `listTools()` / `execute()` throw |

## Exports

Add to `src/index.ts`:

```ts
// MCP
export { connectMcp } from "./mcp/index.js";
export type { McpConfig, McpConnection, McpHttpConfig, McpStdioConfig } from "./mcp/index.js";
```

## Future Extensions

### Resources (future)

MCP resources could be exposed via a `listResources()` method on `McpConnection`.
Resources would return content that can be fed to `Instruct.addFile()`:

```ts
const resources = await mcp.listResources();
const content = await mcp.readResource("file:///path/to/doc.md");
instruct.addFile(content, { name: "doc.md" });
```

### Prompts (future)

MCP prompts could map to Instruct construction:

```ts
const messages = await mcp.getPrompt("summarize", { text: "..." });
// Convert to Instruct or feed directly to Agent
```

### CLI config (future)

```yaml
services:
  mcp:
    - name: filesystem
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"]
    - name: github
      transport: http
      url: http://localhost:3000/mcp
```

## Open Questions

1. **Tool caching:** Should `listTools()` cache results after the first call, or
   always query the server? MCP supports `tools/list_changed` notifications —
   should we listen for those?

2. **Concurrent tool calls:** MCP supports calling tools concurrently. Axle's
   `executeToolCalls` currently calls tools sequentially. Should MCP tools be
   called in parallel when the Agent has multiple tool calls in one turn?

3. **Tool result content types:** MCP tool results can contain images and embedded
   resources, not just text. How should non-text content be handled in the Axle
   tool result string format?
