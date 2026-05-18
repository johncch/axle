# Axle

Axle is a TypeScript library for building multi-turn LLM agents. It provides a
small, focused API for building agentic applications.

**Documentation:** https://axle.fifthrevision.com

## Quick Start

```typescript
import { Agent, Instruct, anthropic } from "@fifthrevision/axle";

const provider = anthropic(process.env.ANTHROPIC_API_KEY);
const agent = new Agent({ provider, model: "claude-sonnet-4-5-20250929" });

const r1 = await agent.send("What is the capital of France?").final;
if (!r1.ok) throw new Error(r1.error.kind);
console.log(r1.response); // "Paris is the capital of France."

// Multi-turn — history is managed automatically
const r2 = await agent.send("And what about Germany?").final;
if (!r2.ok) throw new Error(r2.error.kind);
```

## Philosophy

Axle has two big goals

1. A small, focused, and ergonomic interface for building agents. The Agent,
   Instruct, and other APIs are the entire surface, and there is a lot of thought
   to make them distinct and composable.
2. Systematic prompt improvement. Log what was sent, validate what came back, feed
   learnings into the next run. (This is where the roadmap is headed.)

Axle started as a DSPy-inspired workflow tool. As models got better with reasoning
and tool use, rigid workflow graphs felt unnecessary — but the goals behind them
(structured output, verification, multi-step reasoning) didn't go away. The project
shifted toward making those capabilities composable primitives rather than
fixed pipelines.

### Roadmap

- **Memory:** Ways to remember previous runs to retrieve them and add them back
  into the prompt for future runs.
- **Verification:** Automatic and manual ways to verify the output hits goals

## Core Concepts

### Agent

Agent is the primary interface. It owns the provider, model, system prompt,
tools, and conversation history. `send()` is the only verb — it accepts either a
plain string or an Instruct.

```typescript
const agent = new Agent({
  provider: anthropic(apiKey),
  model: "claude-sonnet-4-5-20250929",
  system: "You are a helpful assistant.",
  tools: [calculatorTool],
});
```

### Instruct

Instruct is a rich message. Use it when you need structured output, file
attachments, bound template inputs, or additional instructions.

```typescript
import * as z from "zod";

const instruct = new Instruct({
  prompt: "Summarize the following {{topic}}.",
  schema: z.object({
    summary: z.string(),
    keyPoints: z.array(z.string()),
  }),
}).withInputs({ topic: "document" });
instruct.addFile(await loadFileContent("./report.pdf"));

const result = await agent.send(instruct).final;
if (!result.ok) throw new Error(result.error.kind);
// result.response is { summary: string, keyPoints: string[] }
```

For plain text interactions, pass a string directly to `send()` instead.

### Providers

Axle ships with first-party support for Anthropic, OpenAI, and Gemini, plus a
generic ChatCompletions provider for any OpenAI-compatible API.

```typescript
import { anthropic, openai, gemini, chatCompletions } from "@fifthrevision/axle";

const a = anthropic(process.env.ANTHROPIC_API_KEY);
const o = openai(process.env.OPENAI_API_KEY);
const g = gemini(process.env.GEMINI_API_KEY);
const local = chatCompletions("http://localhost:11434/v1");
```

### `stream()` and `generate()`

Agent is built on two lower-level primitives that can be used directly when you
want full control without conversation management.

`stream()` runs a tool loop over a streaming request and returns a handle with
callbacks for real-time output:

```typescript
import { stream } from "@fifthrevision/axle";

const handle = stream({
  provider,
  model,
  messages: [{ role: "user", content: "Hello" }],
  tools: [myTool],
  onToolCall: async (name, params) => ({ type: "success", content: "result" }),
});

handle.on((event) => {
  if (event.type === "text:delta") process.stdout.write(event.delta);
});

const result = await handle.final;
if (!result.ok) throw new Error(result.error.kind);
```

`generate()` does the same but without streaming — it returns the final result
directly as a promise:

```typescript
import { generate } from "@fifthrevision/axle";

const result = await generate({
  provider,
  model,
  messages: [{ role: "user", content: "Hello" }],
  tools: [myTool],
  onToolCall: async (name, params) => ({ type: "success", content: "result" }),
});

if (!result.ok) throw new Error(result.error.kind);
result.response; // final assistant message
```

Both `stream()` and `generate()` also accept an `Instruct` as the latest user
turn. When `messages` is provided with `instruct`, `messages` is treated as
prior context and the rendered `Instruct` is appended as the new user message.

```typescript
import * as z from "zod";
import { generate, Instruct } from "@fifthrevision/axle";

const result = await generate({
  provider,
  model,
  messages: previousMessages,
  instruct: new Instruct({
    prompt: "Answer {{question}}.",
    schema: z.object({
      answer: z.string(),
    }),
  }).withInput("question", "Should we proceed?"),
});

if (!result.ok) throw new Error(result.error.kind);
result.response.answer; // string
```

Both handle the full tool-call loop automatically. Agent uses `stream()`
internally and adds history management, system prompt, and callback wiring on
top.

### Results

`generate(...)`, `stream(...).final`, and `agent.send(...).final` all resolve to
a two-state result:

```typescript
if (!result.ok) {
  result.error.kind; // "model" | "tool" | "parse"
  if (result.error.kind === "parse") {
    result.error.message;
  }
  return;
}

result.response; // always present when ok is true
```

For `generate()` and `stream()`, plain calls return the final assistant message.
For `Agent.send("...")`, plain calls return the assistant text. `Instruct`
calls return the parsed schema value. Model, tool, and parse failures return
`ok: false`; abort, fatal tool, configuration, and unexpected execution errors
still throw.

Cancellation follows standard JavaScript abort semantics:

- `handle.cancel(reason)` aborts a `stream()` or `agent.send()` handle.
- `stream().final`, `generate(...)`, and `agent.send(...).final` reject with an error whose `name` is `"AbortError"`.
- Axle abort errors preserve `reason`, `usage`, and partial state where available (`messages`, `partial`, and for `Agent.send`, `turn`).

## Details

### Structured Output

Pass a Zod schema to Instruct. Axle compiles the schema
into output format instructions, then parses the response back into typed
objects.

```typescript
import * as z from "zod";

const instruct = new Instruct({
  prompt: "Tell me about Mars.",
  schema: z.object({
    name: z.string(),
    distanceFromSun: z.number(),
    moons: z.array(z.string()),
  }),
});

const agent = new Agent({ provider, model });
const result = await agent.send(instruct).final;
if (!result.ok) throw new Error(result.error.kind);

result.response.name; // string
result.response.distanceFromSun; // number
result.response.moons; // string[]
```

For one-shot structured calls without agent-managed history, pass the same
`Instruct` directly to `generate()` or `stream()`.

### Tools

A tool is an object with a name, description, Zod schema, and an `execute`
function. Pass tools to the Agent constructor.

```typescript
import { z } from "zod";

const weatherTool = {
  name: "getWeather",
  description: "Get current weather for a city",
  schema: z.object({ city: z.string() }),
  async execute(input) {
    return JSON.stringify({ temp: 72, condition: "sunny" });
  },
};

const agent = new Agent({
  provider,
  model,
  tools: [weatherTool],
});
```

Axle includes several built-in tools: `braveSearchTool`, `calculatorTool`,
`execTool`, `readFileTool`, `writeFileTool`, and `patchFileTool`.

### Provider Tools

Provider tools are tools that execute on the LLM provider's side (e.g. web
search, code interpreter). Pass them via the `providerTools` option using
`{ type: "provider", name: "..." }`.

```typescript
import { Agent, calculatorTool } from "@fifthrevision/axle";
import type { ProviderTool } from "@fifthrevision/axle";

const agent = new Agent({
  provider,
  model,
  tools: [calculatorTool],
  providerTools: [{ type: "provider", name: "web_search" }],
});
```

Axle maps common names to provider-specific identifiers automatically:

| Name             | Anthropic             | OpenAI               | Gemini          |
| ---------------- | --------------------- | -------------------- | --------------- |
| `web_search`     | `web_search_20250305` | `web_search_preview` | `googleSearch`  |
| `code_execution` | —                     | `code_interpreter`   | `codeExecution` |

You can also pass provider-specific names directly. Use the optional `config`
field for provider-specific options:

```typescript
{ type: "provider", name: "web_search", config: { max_results: 5 } }
```

Provider tool events stream as `provider-tool:start` and `provider-tool:complete`.

### MCP (Model Context Protocol)

Axle supports connecting to MCP servers via stdio or HTTP transport. Create an
MCP instance, connect it, and pass it to Agent.

```typescript
import { Agent, MCP } from "@fifthrevision/axle";

const mcp = new MCP({
  transport: "stdio",
  name: "wc",
  command: "npx",
  args: ["tsx", "path/to/wordcount-server.ts"],
});
await mcp.connect();

const agent = new Agent({ provider, model, mcps: [mcp] });
const result = await agent.send("Count the words in 'hello world'").final;
if (!result.ok) throw new Error(result.error.kind);

await mcp.close();
```

The optional `name` field prefixes all tool names from that server (e.g.
`wc_word_count`) to avoid collisions when using multiple MCPs. When omitted,
the server's self-reported name is used as the prefix if available.

HTTP transport works the same way:

```typescript
const mcp = new MCP({
  transport: "http",
  url: "http://localhost:3100/mcp",
});
```

### Streaming

Axle has two event models, used at different levels:

- `Agent.on(...)` emits `AgentEvent` — a high-level turn view organized
  around parts (text, thinking, action).
- `stream(...).on(...)` emits `StreamEvent` — a lower-level view that
  surfaces every text/thinking/tool transition the provider produces.

`Agent` uses `stream()` internally and translates each `StreamEvent` into
one or more `AgentEvent`s.

#### Agent events

```typescript
const agent = new Agent({ provider, model });

agent.on((event) => {
  switch (event.type) {
    case "text:delta":
      process.stdout.write(event.delta);
      break;
    case "part:start":
      if (event.part.type === "action") {
        console.log(`Tool: ${event.part.detail.name}`);
      }
      break;
    case "action:complete":
      console.log("Tool complete");
      break;
    case "turn:end":
      console.log(`Turn ${event.status} (in: ${event.usage.in})`);
      break;
    case "error":
      console.error(event.error);
      break;
  }
});

const handle = agent.send("Write me a poem.");
// handle.cancel(reason) aborts mid-stream and rejects handle.final with an AbortError
try {
  const result = await handle.final;
  if (!result.ok) {
    console.error(result.error);
  }
} catch (err) {
  if (err instanceof Error && err.name === "AbortError") {
    // Cancellation preserves partial state on AxleAbortError: reason, turn, partial, usage
    console.log("Cancelled");
  } else {
    throw err;
  }
}
```

`AgentEvent` types: `session:restore`, `turn:user`, `turn:start`, `turn:end`,
`part:start`, `part:end`, `text:delta`, `thinking:delta`, `action:args-delta`,
`action:running`, `action:progress`, `action:complete`, `action:error`,
`action:child-event`, `error`.

`part:start` carries a `TurnPart`, discriminated by `part.type` (`"text"`,
`"thinking"`, `"file"`, `"action"`). Action parts further discriminate on
`part.kind` (`"tool" | "agent" | "provider-tool"`).

Callbacks are registered once and fire on every subsequent `send()`.

#### stream() events

The low-level `stream()` primitive emits a different event shape — closer
to the raw provider stream, with separate `start`/`end` events for each
text and thinking block, and distinct events for tool request, execution,
and completion.

`StreamEvent` types: `text:start`, `text:delta`, `text:end`,
`thinking:start`, `thinking:delta`, `thinking:end`, `tool:request`,
`tool:exec-start`, `tool:exec-delta`, `tool:exec-complete`,
`provider-tool:start`, `provider-tool:complete`, `turn:complete`,
`tool-results:start`, `tool-results:complete`, `error`.

The `turn:complete` and `tool-results:complete` events carry complete
`AxleAssistantMessage` and `AxleToolCallMessage` objects for client-server
architectures that need authoritative message boundaries.

### Hosting / Sessions

Axle stops at the agent runtime boundary. If you need long-lived sessions,
SSE transport, resumable cursors, or React client hooks, build those concerns
in your host application on top of `Agent`, `agent.on(...)`, and the streamed
turn events that Axle emits.

## Known Limitations

1. Axle does not support multi-modal output right now.

## CLI

In accordance to Axle's lineage of a workflow tool, Axle exposes a command
line interface that accepts a declarative config file.

### Installation

```bash
npm install -g @fifthrevision/axle
```

### Usage

The CLI looks for `axle.job.yaml` and `axle.config.yaml` in the current
directory by default. You can also specify them using the `-j` and `-c` flags

```bash
axle
axle -j path/to/job.yaml -c path/to/config.yaml
axle --args key=value other=thing
axle --debug
```

A job file specifies the provider, task prompt, and optional tools/files:

```yaml
# axle.job.yaml
provider:
  type: anthropic
  model: claude-sonnet-4-5-20250929

task: |
  Summarize the attached document.

tools:
  - calculator

provider_tools:
  - web_search

files:
  - ./data/report.txt
```

### Batch

Add a `batch` key to the job file to run the same task across multiple files.
Each matched file is attached to the instruct automatically.

```yaml
# axle.job.yaml
provider:
  type: openai

task: |
  Summarize this file.

batch:
  files: "./data/*.txt"
  concurrency: 3
  resume: true
```

- `files` — glob pattern for input files
- `concurrency` — max parallel runs (default 3)
- `resume` — skip files already processed in a previous run

### MCP Servers

Add an `mcps` key to connect to MCP servers. Both stdio and HTTP transports
are supported.

```yaml
# axle.job.yaml
provider:
  type: anthropic

mcps:
  - name: wc
    transport: stdio
    command: npx
    args: ["tsx", "examples/mcps/wordcount-server.ts"]
  - transport: http
    url: http://localhost:3100/mcp

task: |
  Count the words in "hello world"
```

Each entry supports:

- `transport` — `"stdio"` or `"http"` (required)
- `name` — prefix for tool names from this server (optional)
- `command` / `args` / `env` — for stdio transport
- `url` / `headers` — for HTTP transport

### Configuration

For CLI use, create an `axle.config.yaml` in your working directory with API
keys:

```yaml
# axle.config.yaml
openai:
  api-key: "<api-key>"
anthropic:
  api-key: "<api-key>"
gemini:
  api-key: "<api-key>"
chatcompletions:
  base-url: "http://localhost:11434/v1"
  model: "llama3"
  api-key: "<api-key>" # optional
```

Provider-level keys in the job file override the config file.
