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
});
```

### Instruct

Instruct is a rich message. Use it when you need structured output, file
attachments, bound template inputs, or host-supplied supporting context.

```typescript
import * as z from "zod";

const instruct = new Instruct({
  prompt: "Summarize the following {{topic}}.",
  schema: z.object({
    summary: z.string(),
    keyPoints: z.array(z.string()),
  }),
}).withInputs({ topic: "document" });
instruct.addContext("Files available: report.pdf", {
  title: "Sandbox manifest",
});
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

### Supporting Context and Files

Use `addContext` for host-supplied information that should remain separate from
the user-authored prompt until final rendering. Typical examples include a
sandbox file manifest, environment details, retrieved records, or application
state:

```typescript
const instruct = new Instruct({
  prompt: "Review the sandbox and propose the next change.",
});

instruct
  .addContext("src/index.ts\nsrc/server.ts\npackage.json", {
    title: "Sandbox files",
  })
  .addContext("Node.js 24\nPackage manager: pnpm", {
    title: "Environment",
  });
```

Context sections are ordered, preserved by `clone()`/`withInputs()`, and do not
perform `{{variable}}` substitution. They still become part of the same final
user-message text, so `addContext` is a composition boundary, not a separate
model instruction priority.

Use `addFile` for actual file content or attachments:

```typescript
instruct.addFile("Inline reference text", { name: "notes.txt" });
instruct.addFile(await loadFileContent("./chart.png"));
```

Inline text files render as reference sections. Images and PDFs remain file
parts and are converted to the selected provider's native input format.

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

The core package does not ship concrete local tools. Define application tools
directly, or use the CLI package's job-file tool names when running jobs through
`axle`.

`execute` receives a `ToolContext` as its second argument. Long-running tools
can stream progress with `ctx.emit(...)`, and tools that call models can report
their token usage with `ctx.reportUsage(usage)` so it is rolled into the parent
operation's totals.

#### File results and deferred references

Tools can return structured text/file parts. A file may be inline, a URL, or a
host-owned deferred reference resolved only when a provider request needs it:

```typescript
import type { ExecutableTool, FileResolver } from "@fifthrevision/axle";
import { z } from "zod";

const readFileSchema = z.object({ id: z.string() });

const readFile: ExecutableTool<typeof readFileSchema> = {
  name: "read_file",
  description: "Read a file from the sandbox",
  schema: readFileSchema,
  async execute({ id }) {
    return [
      {
        type: "file",
        file: {
          kind: "text",
          mimeType: "text/plain",
          name: "result.txt",
          source: { type: "ref", ref: { id } },
        },
      },
    ];
  },
};

const fileResolver: FileResolver = async ({ ref, accepted }) => {
  // Authorize the opaque host ref and return one of the requested formats.
  if (!accepted.includes("text")) {
    throw new Error(`Text resolution is not supported here: ${accepted.join(", ")}`);
  }
  return {
    type: "text",
    content: await sandbox.readText((ref as { id: string }).id),
  };
};

const agent = new Agent({
  provider,
  model,
  tools: [readFile],
  fileResolver,
});
```

Deferred refs remain in message history and session snapshots. Axle resolves
them again on every provider conversion, which avoids persisting expiring
signed URLs. Persisted `ref` values should therefore be JSON-serializable, and
the host must restore a compatible `FileResolver` when resuming a session.

Anthropic, OpenAI Responses, and Gemini accept tool-result files within their
normal image/PDF/text constraints. Chat Completions currently accepts text
tool-result files only.

### Subagent Tools

> **Experimental** — the API is usable today, but event and part shapes
> (notably `SubagentAction`) may change in a minor release while this feature
> is validated in real applications.

`createAgentTool` exposes a child Agent as a normal tool, letting a parent
model delegate bounded work and receive only the child's final response.

```typescript
import { Agent, createAgentTool } from "@fifthrevision/axle";
import { z } from "zod";

const researcher = createAgentTool({
  name: "research",
  description: "Delegate a research question to a focused subagent",
  schema: z.object({ question: z.string() }),
  createAgent: () =>
    new Agent({
      provider: anthropic({ apiKey }),
      model: "claude-haiku-4-5-20251001",
      system: "You are a focused researcher. Answer concisely.",
    }),
  prompt: (input) => input.question,
});

const agent = new Agent({ provider, model, tools: [researcher] });
```

The child's turn events are forwarded through the parent's event stream
(rendered as an `agent` action part with nested child turns), and its token
usage is reported into the parent's totals with per-model attribution (see
[Usage stats](#usage-stats)). Create a fresh child Agent per call — `createAgent`
runs once per tool invocation.

### Parallelizing Tools

> **Experimental** — the generated tool's result JSON (`ParallelToolResult`)
> may change in a minor release.

`parallelize` wraps a tool in a batch variant that runs many inputs
concurrently in a single tool call. Combined with `createAgentTool`, this fans
out subagents.

```typescript
import { parallelize } from "@fifthrevision/axle";

const batchResearch = parallelize(researcher, { maxConcurrency: 4 });
// → tool "research_batch" accepting { items: [{ question }, ...] }

const agent = new Agent({ provider, model, tools: [batchResearch] });
```

The generated tool preserves input order and reports per-item failures instead
of failing the whole batch; fatal (`AxleToolFatalError`) and abort errors still
terminate the run like an unbatched tool. Options: `name`, `description`,
`maxItems` (default 50), `maxConcurrency` (default 8). The batch tool inherits
the wrapped tool's `kind`, so batched subagents still stream their child turns
under the batch action (interleaved across items).

### Usage Stats

> **Experimental** — the aggregate fields are stable; the `breakdown` entry
> shape (`UsageEntry`) may gain dimensions (e.g. a per-agent name) in a minor
> release.

Every result exposes `usage` totals (`in`, `out`, plus cache/reasoning detail
when reported). When an operation spans models — for example subagent tools on
different providers — `usage.breakdown` holds one entry per provider+model pair
so cost can be reconstructed:

```typescript
const result = await agent.send("...").final;
// result.usage.breakdown:
// [
//   { provider: "anthropic", model: "claude-sonnet-4-6", in: 1200, out: 340 },
//   { provider: "openai", model: "gpt-5", in: 800, out: 120 },
// ]
```

Breakdown entries explain the aggregate totals; they are attribution metadata,
not additional usage.

### Provider Tools

Provider tools are tools that execute on the LLM provider's side (e.g. web
search, code interpreter). Pass them via the `providerTools` option using
`{ type: "provider", name: "..." }`.

```typescript
import { Agent } from "@fifthrevision/axle";
import type { ProviderTool } from "@fifthrevision/axle";

const agent = new Agent({
  provider,
  model,
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

- `Agent.on(...)` emits `TurnEvent` — a high-level turn view organized
  around parts (text, thinking, action).
- `stream(...).on(...)` emits `StreamEvent` — a lower-level view that
  surfaces every text/thinking/tool transition the provider produces.

`Agent` uses `stream()` internally and translates each `StreamEvent` into
one or more `TurnEvent`s.

#### Turn events

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

`TurnEvent` types: `session:restore`, `turn:user`, `turn:start`, `turn:end`,
`part:start`, `part:end`, `text:delta`, `thinking:delta`, `action:args-delta`,
`action:running`, `action:progress`, `action:complete`, `action:error`,
`action:child-event`, `annotation:start`, `annotation:update`,
`annotation:end`, `error`.

`part:start` carries a `TurnPart`, discriminated by `part.type` (`"text"`,
`"thinking"`, `"file"`, `"action"`). Action parts further discriminate on
`part.kind` (`"tool" | "agent" | "provider-tool"`).

Callbacks are registered once and fire on every subsequent `send()`.

#### Turn accumulator

`Turn` objects are accumulated render state. They are the snapshot counterpart
to `TurnEvent` streams: text deltas are folded into text parts, tool call
lifecycles become stable action parts, and tool results are collapsed back into
the action part that produced them. `AxleMessage[]` remains the canonical model
conversation state; turns do not affect model input or tool routing.

Hosts that transport Axle events over SSE, WebSockets, or another mixed event
stream can use `TurnAccumulator` instead of reimplementing this reducer:

```typescript
import { TurnAccumulator, type Annotation } from "@fifthrevision/axle/ui";

type AppAnnotation =
  | Annotation<{ image: string }, "sandbox">
  | Annotation<{ score: number; passed: boolean }, "eval">;

type HostEvent = { type: "run:terminal"; status: string };

const accumulator = new TurnAccumulator<AppAnnotation, HostEvent>();

for await (const event of events) {
  const { handled, state } = accumulator.apply(event);

  if (!handled) {
    // event is typed as HostEvent here
    applyHostEvent(event);
  }

  render(state.turns);
}
```

Use `@fifthrevision/axle/ui` for browser-safe presentation primitives. It
exports turns, annotations, turn events, and `TurnAccumulator` without importing
providers, MCP, tools, or other server-side runtime code.

The accumulator accepts open event objects. Unknown host events, such as
`run:terminal` or `session:expired`, return `handled: false` and leave the
state unchanged. Session-level annotations are accumulated in
`state.sessionAnnotations`; turn and part annotations are embedded on their
targets. The accumulator is not idempotent; callers should deduplicate replayed
transport events before applying them.

#### Turn metadata

User messages can carry stable host-owned metadata for rendering. Metadata is
stored in history, copied onto the corresponding user `Turn`, and ignored by
providers.

```typescript
await agent.send("Rewrite this prompt", {
  metadata: { surface: "prompt-editor" },
});

const instruct = new Instruct({
  prompt: "Review this prompt",
  metadata: { surface: "prompt-review" },
});
```

Use metadata for stable facts about the message, such as which UI surface
created it. Use annotations for lifecycle UI, async status, or render data that
needs explicit placement before or after a turn or part.

#### Annotations

Annotations are embedded render metadata for sessions, turns, and parts. They
are useful for out-of-band UI such as sandbox startup, eval results, deployment
state, or any other consumer-owned status that should render alongside turns
without becoming model state.

```typescript
type EvalAnnotation = Annotation<{ score: number; passed: boolean }, "eval">;

const annotation: EvalAnnotation = {
  id: crypto.randomUUID(),
  kind: "eval",
  label: "Plan adherence",
  placement: "after",
  status: "complete",
  data: { score: 0.92, passed: true },
};

agentEventSink({
  type: "annotation:end",
  target: { type: "turn", turnId },
  annotation,
});
```

Annotation `label` is required so generic renderers have a common UI surface.
`placement` defaults to `"after"`, and `annotation:end` defaults missing
`status` to `"complete"` in accumulated state. `annotation:update` and
`annotation:end` carry the full updated annotation object; Axle does not define
patch or merge semantics for annotation data.

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
line interface that accepts a declarative YAML job file.

### Installation

```bash
npm install -g @fifthrevision/axle-cli
```

### Usage

The CLI requires an explicit YAML job file using the `-j` flag.

```bash
axle -j path/to/job.yaml
axle -j path/to/job.yaml --args key=value other=thing
axle -j path/to/job.yaml --debug
```

A job file specifies the provider, task prompt, and optional tools/files:

```yaml
# job.yaml
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

CLI job files can use these local tool names:

- `calculator`
- `exec`
- `patch-file`
- `read-file`
- `write-file`

### Batch

Add a `batch` key to the job file to run the same task across multiple files.
Each matched file is attached to the instruct automatically.

```yaml
# job.yaml
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
# job.yaml
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

For CLI use, put provider secrets in your environment or a local `.env` file:

```bash
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
```

Optional model overrides use provider-specific variables:

```bash
OPENAI_MODEL=gpt-4.1
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
GEMINI_MODEL=gemini-2.5-pro
```

For OpenAI-compatible endpoints:

```bash
CHATCOMPLETIONS_BASE_URL=http://localhost:11434/v1
CHATCOMPLETIONS_MODEL=llama3
CHATCOMPLETIONS_API_KEY=...
```

Provider-level keys in the job file override environment variables. To
reference a non-standard environment variable from a job file, use `apiKeyEnv`:

```yaml
provider:
  type: openai
  apiKeyEnv: CUSTOM_OPENAI_KEY
```
