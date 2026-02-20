# MCP Adapter Design

**Date:** 2026-02-20
**Status:** Draft (v2)

## Overview

Add an MCP (Model Context Protocol) adapter to Axle that treats MCP servers as
first-class citizens alongside local tools. The `MCP` class manages a connection
to an MCP server, discovers its tools, and exposes them as Axle `Tool` objects.
Agents accept MCP instances directly via a `mcps` config option and handle tool
flattening internally.

This revision also introduces rich tool result content (text + images) throughout
the tool pipeline to support MCP servers like Figma that return image data.

## Goals

- `MCP` class — object-oriented API consistent with `Agent`
- First-class MCP support in `Agent` via `mcps` config
- Rich tool results — support images alongside text in `AxleToolCallResult`
- Connect to MCP servers via **stdio** and **streamable HTTP** transports
- Convert MCP tools into Axle `Tool` objects transparently
- Designed for future extensibility (resources, prompts)

## Non-Goals (for now)

- MCP resources (data sources)
- MCP prompts (reusable templates)
- MCP sampling (server-initiated LLM requests)
- CLI config integration (YAML `services.mcp` section)
- MCP `tools/list_changed` notification handling (tools resolved once per Agent)

## Architecture

```
┌──────────────────────────────────────────────────────┐
│ Agent                                                │
│   tools: Tool[]       ← local tools                  │
│   mcps: MCP[]         ← first-class MCP instances    │
│   provider: AIProvider                               │
│                                                      │
│   On first send():                                   │
│     Resolve MCP tools → merge into tool registry     │
└─────────┬──────────────────────┬─────────────────────┘
          │                      │
          │ tool.execute()       │ tool.execute()
          ▼                      ▼
┌──────────────────┐   ┌──────────────────────┐
│ Local Tool       │   │ MCP Tool (proxy)     │
│ execute() → fn   │   │ execute() → callTool │
│ returns string   │   │ returns rich content │
└──────────────────┘   └─────────┬────────────┘
                                 │ JSON-RPC
                                 ▼
                       ┌──────────────────────┐
                       │ MCP Server           │
                       │ (stdio or HTTP)      │
                       └──────────────────────┘
```

Once resolved, MCP tools are indistinguishable from local tools in the Agent's
tool registry. The only difference is that `execute()` proxies the call to the
MCP server and may return rich content (text + images).

---

## API Design

### Creating an MCP connection

```ts
import { MCP } from "@fifthrevision/axle";

// Stdio transport — spawn a child process
const fs = new MCP({
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"],
});
await fs.connect();

// Streamable HTTP transport — connect to a remote server
const figma = new MCP({
  transport: "http",
  url: "https://mcp.figma.com",
  headers: { Authorization: "Bearer ..." },
});
await figma.connect();
```

The constructor stores config. `connect()` performs the async handshake
(transport setup, capability negotiation). This mirrors the `Agent` pattern
where construction is sync and work happens in async methods.

### Listing tools directly

```ts
const tools = await fs.listTools();
// tools: Tool[] — standard Axle tools, ready to use

// With prefix to avoid name collisions
const tools = await fs.listTools({ prefix: "fs" });
// tool names: "fs_read_file", "fs_write_file", etc.
```

`listTools()` fetches tools from the server on first call and caches the result.
Subsequent calls return the cached list. Call `refreshTools()` to re-fetch.

### Using with Agent (preferred)

```ts
import { Agent, MCP, anthropic } from "@fifthrevision/axle";

const fs = new MCP({
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"],
});
await fs.connect();

const figma = new MCP({
  transport: "http",
  url: "https://mcp.figma.com",
  headers: { Authorization: "Bearer ..." },
});
await figma.connect();

const agent = new Agent({
  provider: anthropic(apiKey),
  model: "claude-sonnet-4-20250514",
  tools: [calculatorTool],       // local tools
  mcps: [fs, figma],             // MCP servers — Agent resolves tools internally
});

const result = await agent.send("Get the latest designs from Figma").final;

// Clean up
await fs.close();
await figma.close();
```

Agent resolves MCP tools lazily on the first `send()` call, merges them into its
tool registry alongside local tools, and caches the result. No manual
`listTools()` + spread required.

### Using with stream()/generate() directly

For lower-level usage without Agent, use `listToolDefinitions()` to get
`ToolDefinition[]` (schema-only, no execute) and `listTools()` for execution:

```ts
import { MCP, stream } from "@fifthrevision/axle";

const mcp = new MCP({ transport: "stdio", command: "...", args: [...] });
await mcp.connect();

const toolDefs = await mcp.listToolDefinitions();
const tools = await mcp.listTools();

const handle = stream({
  provider,
  model,
  messages,
  tools: toolDefs,
  onToolCall: async (name, params) => {
    const tool = tools.find(t => t.name === name);
    if (!tool) return null;
    const result = await tool.execute(params);
    return { type: "success", content: result };
  },
});
```

---

## MCP Class

```ts
class MCP {
  constructor(config: MCPConfig);

  /** Connect to the MCP server. Must be called before any other method. */
  connect(): Promise<void>;

  /** List tools with execute(), for Agent or manual execution. Cached after first call. */
  listTools(options?: { prefix?: string }): Promise<Tool[]>;

  /** List tool definitions (name + description + schema) for stream()/generate(). */
  listToolDefinitions(options?: { prefix?: string }): Promise<ToolDefinition[]>;

  /** Force re-fetch tools from the server. */
  refreshTools(): Promise<Tool[]>;

  /** Close the connection and clean up resources. */
  close(): Promise<void>;

  /** Whether the connection is active. */
  get connected(): boolean;
}
```

---

## Agent Changes

### AgentConfig

```ts
export interface AgentConfig {
  provider: AIProvider;
  model: string;
  system?: string;
  tools?: Tool[];
  mcps?: MCP[];        // NEW
  tracer?: TracingContext;
}
```

### Agent methods

```ts
class Agent {
  // Existing
  addTool(tool: Tool): void;
  addTools(tools: Tool[]): void;

  // New
  addMcp(mcp: MCP): void;
  addMcps(mcps: MCP[]): void;
}
```

### Internal tool resolution

On the first `send()` call, Agent resolves MCP tools and merges them:

```ts
private async resolveMcpTools(): Promise<void> {
  if (this.mcpToolsResolved) return;
  for (const mcp of this.mcps) {
    const tools = await mcp.listTools();
    this.addTools(tools);
  }
  this.mcpToolsResolved = true;
}
```

This runs inside the `execute()` method's promise chain, before the stream is
created. The `AgentHandle` is still returned synchronously — only the internal
`final` promise awaits MCP resolution before starting the LLM stream.

### Tradeoffs of first-class MCP in Agent

**Pros:**
- Clean API — users pass `mcps: [fs, figma]` and it just works
- Agent manages the full tool lifecycle (resolution, caching, name conflicts)
- No boilerplate `listTools()` + spread + manual cleanup pattern
- Natural place for future `tools/list_changed` notification handling
- Consistent with how `tools` already works — Agent owns the registry

**Cons:**
- Agent gains a dependency on the `MCP` type (though it's a lightweight interface)
- First `send()` has latency from MCP tool resolution (mitigated by caching)
- Error surface grows — MCP connection failures can now happen inside `send()`
- Tool name collisions between MCPs or MCP vs local tools need a strategy

**Name collision strategy:** If two tools share a name, the last one wins (same
as current `addTools` behavior). Users can use `listTools({ prefix })` for
manual resolution, or we can add a `prefix` option to the `mcps` config:

```ts
mcps: [
  { mcp: fsMcp, prefix: "fs" },
  { mcp: figmaMcp, prefix: "figma" },
]
```

This is a future enhancement — for v1, last-wins is sufficient and matches
existing behavior.

---

## Rich Tool Results (Image Support)

### Motivation

MCP servers like Figma return images in tool results. Currently,
`AxleToolCallResult.content` is `string`, which means image data is lost.
We need to support mixed text + image content throughout the tool pipeline.

### New types in `messages/message.ts`

```ts
export type ToolResultPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface AxleToolCallResult {
  id: string;
  name: string;
  content: string | ToolResultPart[];   // was: string
}
```

When `content` is a `string`, behavior is identical to today. When it's an
array of `ToolResultPart`, providers map each part to their native format.

### Changes to Tool interface

```ts
// tools/types.ts
export interface Tool<TSchema extends ZodObject<any> = ZodObject<any>> {
  name: string;
  description: string;
  schema: TSchema;
  execute(input: z.infer<TSchema>): Promise<string | ToolResultPart[]>;  // was: Promise<string>
  configure?(config: Record<string, any>): void;
  summarize?(input: z.infer<TSchema>): string;
}
```

Existing tools that return `Promise<string>` are unchanged — `string` is a
valid member of the union. Only MCP tools (or future tools with rich output)
return `ToolResultPart[]`.

### Changes to ToolCallResult in `providers/helpers.ts`

```ts
export type ToolCallResult =
  | { type: "success"; content: string | ToolResultPart[] }   // was: string
  | { type: "error"; error: { type: string; message: string; fatal?: boolean; retryable?: boolean } };
```

The `executeToolCalls` function passes through whatever `content` type it
receives — no changes to its logic needed since it just assigns the value
to `AxleToolCallResult.content`.

### Changes to Agent.execute() onToolCall

```ts
onToolCall: async (name, params) => {
  const tool = tools[name];
  if (!tool) return null;
  try {
    const result = await tool.execute(params);
    // No longer JSON.stringify — pass through as-is
    const content = typeof result === "string" ? result : result;
    return { type: "success", content };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { type: "error", error: { type: "execution", message: msg } };
  }
},
```

### Provider changes

Each provider's message conversion handles the new union type for tool results:

**Anthropic** (`providers/anthropic/utils.ts`):
```ts
// Tool result content — Anthropic natively supports mixed content
if (msg.role === "tool") {
  return {
    role: "user",
    content: msg.content.map((r) => ({
      type: "tool_result",
      tool_use_id: r.id,
      content: typeof r.content === "string"
        ? r.content
        : r.content.map((part) =>
            part.type === "text"
              ? { type: "text", text: part.text }
              : { type: "image", source: { type: "base64", media_type: part.mimeType, data: part.data } }
          ),
    })),
  };
}
```

**OpenAI** (`providers/openai/utils.ts`):
```ts
// OpenAI Responses API — natively supports images in function_call_output
// output accepts: string | Array<ResponseInputText | ResponseInputImage | ResponseInputFile>
function convertToolMessage(msg) {
  return msg.content.map((r) => ({
    type: "function_call_output",
    call_id: r.id,
    output: typeof r.content === "string"
      ? r.content
      : r.content.map((part) =>
          part.type === "text"
            ? { type: "input_text", text: part.text }
            : { type: "input_image", image_url: `data:${part.mimeType};base64,${part.data}` }
        ),
  }));
}
```

**Gemini** (`providers/gemini/utils.ts`):
```ts
// Gemini — supports inlineData parts nested in functionResponse
function convertToolMessage(msg) {
  return {
    role: "user",
    parts: msg.content.flatMap((item) => {
      const responsePart = {
        functionResponse: {
          id: item.id,
          name: item.name,
          response: typeof item.content === "string"
            ? { output: item.content }
            : {
                output: item.content
                  .filter((p) => p.type === "text")
                  .map((p) => p.text)
                  .join("\n"),
              },
        },
      };

      if (typeof item.content === "string") return [responsePart];

      // Append image parts as inlineData siblings to the functionResponse part
      const imageParts = item.content
        .filter((p) => p.type === "image")
        .map((p) => ({ inlineData: { mimeType: p.mimeType, data: p.data } }));

      return [responsePart, ...imageParts];
    }),
  };
}
```

**ChatCompletions** (`providers/chatcompletions/utils.ts`):
```ts
// Generic chat completions — text only (spec restricts tool messages to text)
function convertToolMessage(msg) {
  return msg.content.map((r) => ({
    role: "tool",
    content: typeof r.content === "string"
      ? r.content
      : r.content
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n"),
    tool_call_id: r.id,
  }));
}
```

**Summary:** Three out of four providers support images natively:

| Provider | Image support in tool results |
|----------|------|
| **Anthropic** | Yes — `image` content blocks with base64 source |
| **OpenAI (Responses API)** | Yes — `input_image` with data URL or `file_id` |
| **Gemini** | Yes (3.x only) — `inlineData` parts nested alongside `functionResponse`. Gemini 2.x does not support multimodal function responses and will return a 400 error. |
| **ChatCompletions (generic)** | No — spec restricts tool messages to text only |

---

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

    async execute(input): Promise<string | ToolResultPart[]> {
      const result = await client.callTool({
        name: mcpTool.name,  // always use original name with server
        arguments: input,
      });

      if (result.isError) {
        throw new Error(formatErrorContent(result.content));
      }

      return formatToolResult(result.content);
    },
  };
}
```

### Result formatting

MCP `tools/call` returns `content` as an array of typed blocks. Conversion:

```ts
function formatToolResult(
  content: McpContent[],
): string | ToolResultPart[] {
  const hasImages = content.some((c) => c.type === "image");

  if (!hasImages) {
    // Text-only — return as plain string for backward compatibility
    return content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }

  // Mixed content — return as ToolResultPart[]
  return content
    .filter((c) => c.type === "text" || c.type === "image")
    .map((c) => {
      if (c.type === "text") {
        return { type: "text" as const, text: c.text };
      }
      return { type: "image" as const, data: c.data, mimeType: c.mimeType };
    });
}
```

Text-only results stay as plain strings so existing tools and providers work
without change. Only when images are present do we use the array format.

---

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

---

## Type Definitions

```ts
// --- MCP Config ---

interface MCPStdioConfig {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface MCPHttpConfig {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
}

type MCPConfig = MCPStdioConfig | MCPHttpConfig;

// --- Rich tool results ---

type ToolResultPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };
```

---

## File Structure

```
src/mcp/
├── index.ts           # Re-exports: MCP class, types
├── MCP.ts             # MCP class implementation
├── tools.ts           # MCP tool → Axle tool conversion, result formatting
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
| MCP server fails to start | `mcp.connect()` throws with descriptive error |
| MCP server crashes mid-session | `tool.execute()` throws, Agent handles via tool error flow |
| Tool not found on server | MCP SDK throws, wrapped as tool execution error |
| Schema conversion fails | Warning logged, fall back to permissive schema |
| Connection already closed | `listTools()` / `execute()` throw |
| MCP not connected when Agent sends | `resolveMcpTools()` throws — MCP must be connected first |

## Exports

Add to `src/index.ts`:

```ts
// MCP
export { MCP } from "./mcp/index.js";
export type { MCPConfig, MCPHttpConfig, MCPStdioConfig } from "./mcp/index.js";

// Rich tool results (from messages)
export type { ToolResultPart } from "./messages/message.js";
```

## Files Modified (outside `src/mcp/`)

| File | Change |
|------|--------|
| `src/messages/message.ts` | Add `ToolResultPart`, update `AxleToolCallResult.content` union |
| `src/tools/types.ts` | Update `Tool.execute()` return type |
| `src/providers/helpers.ts` | Update `ToolCallResult.content` type |
| `src/core/Agent.ts` | Add `mcps` config, `addMcp()`, lazy MCP tool resolution |
| `src/providers/anthropic/utils.ts` | Handle rich content in tool result conversion (image blocks) |
| `src/providers/openai/utils.ts` | Handle rich content in tool result conversion (input_image) |
| `src/providers/gemini/utils.ts` | Handle rich content in tool result conversion (inlineData) |
| `src/providers/chatcompletions/utils.ts` | Text-only fallback for tool results (spec limitation) |
| `src/index.ts` | Export `MCP`, `MCPConfig`, `ToolResultPart` |

---

## Future Extensions

### Resources (future)

MCP resources could be exposed via a `listResources()` method on `MCP`:

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
    - name: figma
      transport: http
      url: https://mcp.figma.com
```

### MCP prefix in Agent config (future)

```ts
const agent = new Agent({
  provider: anthropic(apiKey),
  model: "claude-sonnet-4-20250514",
  mcps: [
    { mcp: fsMcp, prefix: "fs" },
    { mcp: figmaMcp, prefix: "figma" },
  ],
});
```

## Open Questions

1. **Tool caching lifetime:** `listTools()` caches after first call. Should
   `refreshTools()` be called automatically on any schedule, or only manually?

2. **Concurrent tool calls:** MCP supports calling tools concurrently. Axle's
   `executeToolCalls` currently calls tools sequentially. Should MCP tools be
   called in parallel when the Agent has multiple tool calls in one turn?

3. **Agent lifecycle:** Should `Agent` close MCP connections when it's done, or
   is that always the caller's responsibility? Current design: caller manages.
