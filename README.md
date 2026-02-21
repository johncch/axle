# Axle

Axle is a TypeScript library for building multi-turn LLM agents. It provides a
small, focused API for building agentic applications.

## Quick Start

```typescript
import { Agent, Instruct, anthropic } from "@fifthrevision/axle";

const provider = anthropic(process.env.ANTHROPIC_API_KEY);
const agent = new Agent({ provider, model: "claude-sonnet-4-5-20250929" });

const r1 = await agent.send("What is the capital of France?").final;
console.log(r1.response); // "Paris is the capital of France."

// Multi-turn — history is managed automatically
const r2 = await agent.send("And what about Germany?").final;
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
attachments, variable substitution, or additional instructions.

```typescript
import * as z from "zod";

const instruct = new Instruct("Summarize the following document.", {
  summary: z.string(),
  keyPoints: z.array(z.string()),
});
instruct.addFile(await loadFileContent("./report.pdf"));

const result = await agent.send(instruct).final;
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

handle.onPartUpdate((index, type, delta) => process.stdout.write(delta));
const result = await handle.final;
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
```

Both handle the full tool-call loop automatically. Agent uses `stream()`
internally and adds history management, system prompt, and callback wiring on
top.

## Details

### Structured Output

Pass a Zod schema as the second argument to Instruct. Axle compiles the schema
into output format instructions, then parses the response back into typed
objects.

```typescript
import * as z from "zod";

const instruct = new Instruct("Tell me about Mars.", {
  name: z.string(),
  distanceFromSun: z.number(),
  moons: z.array(z.string()),
});

const agent = new Agent({ provider, model });
const result = await agent.send(instruct).final;

result.response.name; // string
result.response.distanceFromSun; // number
result.response.moons; // string[]
```

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

### Server Tools

Server tools are provider-managed tools that execute on the provider's side
(e.g. web search, code interpreter). Pass them alongside regular tools using
`{ type: "server", name: "..." }`.

```typescript
import { Agent } from "@fifthrevision/axle";
import type { ServerTool } from "@fifthrevision/axle";

const agent = new Agent({
  provider,
  model,
  tools: [
    { type: "server", name: "web_search" },
    calculatorTool, // regular tools work alongside server tools
  ],
});
```

Axle maps common names to provider-specific identifiers automatically:

| Name             | Anthropic                | OpenAI               | Gemini           |
| ---------------- | ------------------------ | -------------------- | ---------------- |
| `web_search`     | `web_search_20250305`    | `web_search_preview` | `googleSearch`   |
| `code_execution` | —                        | `code_interpreter`   | `codeExecution`  |

You can also pass provider-specific names directly. Use the optional `config`
field for provider-specific options:

```typescript
{ type: "server", name: "web_search", config: { max_results: 5 } }
```

Server tool events stream as `internal-tool:start` and `internal-tool:complete`.

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

Agent exposes a single `on()` method for streaming events as they arrive.

```typescript
const agent = new Agent({ provider, model });

agent.on((event) => {
  switch (event.type) {
    case "text:delta":
      process.stdout.write(event.delta);
      break;
    case "tool:execute":
      console.log(`Running tool: ${event.name}`);
      break;
    case "error":
      console.error(event.error);
      break;
  }
});

const handle = agent.send("Write me a poem.");
// handle.cancel() to abort mid-stream
const result = await handle.final;
```

Event types include `text:start`, `text:delta`, `text:end`, `thinking:start`,
`thinking:delta`, `thinking:end`, `tool:start`, `tool:execute`,
`tool:complete`, `internal-tool:start`, `internal-tool:complete`, and `error`.

Callbacks are registered once and fire on every subsequent `send()`.

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

server_tools:
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
