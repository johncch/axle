# Axle

Axle is a TypeScript library for building multi-turn LLM agents. It provides a
small, focused API for building agentic applications.

**Documentation:** https://axle.fifthrevision.com

## Introduction

I built Axle while working on a command line AI task runner. I wanted a TypeScript-native library that would work across different inference providers.

It started as a workflow runner inspired by the composability of DSPy. As models got better with reasoning and tool use, many of the early abstractions, such as workflow shapes and expilicit chain-of-thought constructs became unnecessary.

Today, Axle focuses on bringing modern agentic patterns to TypeScript with sensible defaults and minimal setup.

This library is for you if:

- You want a TypeScript-native library.
- You want to build multi-turn LLM agents without wiring up a framework.
- You want an ergonomic API with thoughtful defaults.
- You want to switch inference providers without rewriting your agents.

Axle powers [Sunnyday](https://www.sunnyday.run), a hosted
AI Agent platform. It also forms the core of [Axle CLI](https://www.npmjs.com/package/@fifthrevision/axle-cli) and other experiments such as [Axle Code](https://github.com/johncch/axle-code)

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

## Core Concepts

### Agent

Agent is the primary interface. It owns the provider, model, system prompt,
tools, and conversation history. `send()` starts immediately when the agent is
idle and otherwise queues FIFO. It accepts either a plain string or an
Instruct.

```typescript
const agent = new Agent({
  provider: anthropic(apiKey),
  model: "claude-sonnet-4-5-20250929",
  system: "You are a helpful assistant.",
});
```

To interject while the agent is working, stop the active turn and send the
follow-up:

```typescript
const h1 = agent.send("Build the feature.");

// later, from an event handler while h1 is executing:
agent.stop(); // returns false if no turn is executing yet
const h2 = agent.send("Make the button blue.");
```

`agent.stop()` asks the active turn to finish at its next complete tool-batch
boundary: every tool in the in-flight batch completes—including parallel
calls—and commits, then the handle settles without another provider request.
A turn whose response requests no tools completes normally. `stop()` returns
`false` when no turn is executing, and never affects queued sends. To drop
queued work as well, call `agent.clear()`: it cancels every queued operation
(each cleared handle rejects with an `AxleAgentAbortError`, committing
nothing) and returns the number cleared, leaving the active turn untouched.
`stop(); clear(); send(next)` makes `next` the very next turn. The
transcript stays linear: the committed batch is visible to the follow-up
turn.

Each `final` resolves only that handle's result: `h1` settles at the stop
boundary and does not absorb `h2`'s response. A stopped turn ends on its
tool-call exchange, so a plain send resolves with whatever text that turn
produced (often empty) and an Instruct send may resolve `ok: false` with a
parse error — no final answer exists yet by design.

Cancellation is handle-local, and the user message commits when the provider
request is made. Cancelling a queued handle removes it without committing its
user message; cancelling the running handle before its provider request (for
example during setup or automatic compaction) also commits nothing; after
that point the committed user message remains and the agent turn is marked
cancelled. Other queued handles continue. `stop()` never interrupts a running
provider request or tool batch; use cancellation when a hard stop is
required.

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

Two options bound the tool loop. `maxIterations` caps the number of model
turns; `maxContextTokens` caps the context budget, checked after each turn's
tools are answered against that turn's reported usage (effective input +
output). Crossing either limit is a stop, not an error: the loop returns
`ok: true` with everything accumulated so far and `stopped` set to
`"max-iterations"` or `"token-limit"`. The caller decides what happens next —
e.g. compact the conversation and start a new call. Non-positive limits throw
at call time.

### Results

`generate(...)`, `stream(...).final`, and `agent.send(...).final` all resolve
to a two-state result:

```typescript
if (!result.ok) {
  result.error.kind; // "model" | "tool" | "parse"
  result.error.message; // present for every error kind
  return;
}

result.response; // always present when ok is true
result.stopped; // "max-iterations" | "token-limit" when a loop limit ended the run
```

For `generate()` and `stream()`, plain calls return the final assistant message.
For `Agent.send("...")`, plain calls return the assistant text. `Instruct`
calls return the parsed schema value. Model, tool, and parse failures return
`ok: false`; abort, fatal tool, configuration, and unexpected execution errors
still throw.

Cancellation follows standard JavaScript abort semantics:

- `handle.cancel(reason)` aborts that stream or send handle only.
- A cancelled Agent handle commits no user turn unless its provider request
  was already made; after that point the committed user turn remains and the
  agent turn is marked cancelled.
- `stream().final`, `generate(...)`, and Agent handle finals reject with an
  error whose `name` is `"AbortError"`.
- Axle abort errors preserve `reason`, `usage`, and partial state where
  available (`messages`, `partial`, and for Agent handles, `turn`).

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

> **Experimental** — the generated tool's result parts (`ParallelToolResult`)
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
terminate the run like an unbatched tool. It returns ordered tool-result parts:
each item starts with a text marker containing `index` and `ok`/`error`,
followed by the child's text or file parts. Options: `name`, `description`,
`maxItems` (default 50), `maxConcurrency` (default 8), and `maxResultBytes`
(default 20 MiB). Over-budget child output is omitted per item with a marker
that includes the item index, input, output size, remaining budget, and total
limit; later items still render if they fit. The batch tool inherits the wrapped
tool's `kind`, so batched subagents still stream their child turns under the
batch action (interleaved across items).

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

### Web Search Fallback

`web_search` is native-first. OpenAI, Anthropic, Gemini, and OpenRouter use their
provider-managed search implementation. Providers without native search use the
process-wide fallback configured at application startup:

```typescript
import { braveWebSearch, configureAxle } from "@fifthrevision/axle";

configureAxle({
  webSearchFallback: braveWebSearch({
    apiKey: process.env.BRAVE_API_KEY!,
    maxResults: 5,
    maxTokens: 4_096,
  }),
});
```

The bundled backend uses Brave Search's LLM Context endpoint. Each result
contains a title, URL, and query-relevant extracted passages:

```typescript
interface WebSearchResult {
  title: string;
  url: string;
  snippets: string[];
}
```

Axle recognizes the official OpenRouter and Together endpoint hostnames and
applies their request differences automatically:

```typescript
const together = chatCompletions("https://api.together.ai/v1", {
  apiKey: process.env.TOGETHER_API_KEY!,
});
```

Set `vendor: "openrouter"` or `vendor: "together"` explicitly when using a
proxy or gateway with a different hostname.

Application code continues to request the provider-neutral capability:

```typescript
const agent = new Agent({
  provider,
  model,
  providerTools: [{ type: "provider", name: "web_search" }],
});
```

Axle snapshots global configuration when `generate()`, `stream()`, or
`Agent.send()` starts. If the selected provider has no native search and no
fallback is configured, the operation fails before sending a model request.
Provider-specific `web_search.config` is ignored when the fallback is
selected; configure fallback behavior on `braveWebSearch()` instead.

The fallback is exposed to the model as an ordinary executable tool, so it
produces `tool:*` events rather than `provider-tool:*` events. Applications that
want completely custom search behavior can register their own executable
`web_search` tool instead of requesting the provider tool.

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

`TurnEvent` types: `turn:user`, `turn:start`, `turn:end`, `part:start`,
`part:end`, `text:delta`, `thinking:delta`, `action:args-delta`,
`action:running`, `action:progress`, `action:complete`, `action:error`,
`action:child-event`, `compaction:delta`, `compaction:complete`,
`compaction:error`, `annotation:start`, `annotation:update`,
`annotation:end`, `error`.

The `compaction:*` events mirror the action lifecycle: a compaction part
arrives `running` via `part:start`, `compaction:delta` streams progressive
summary text onto it, and exactly one of `compaction:complete` /
`compaction:error` settles it.

`part:start` carries a `TurnPart`, discriminated by `part.type` (`"text"`,
`"thinking"`, `"file"`, `"action"`, `"compaction"`). Action parts further
discriminate on `part.kind` (`"tool" | "agent" | "provider-tool"`).

Callbacks are registered once and fire on every subsequent `send()`, and also
receive the events of a manual `agent.compact()` (an engine-opened turn
wrapping the compaction part).

#### Turn accumulator

`Turn` objects are accumulated render state. They are the snapshot counterpart
to `TurnEvent` streams: text deltas are folded into text parts, tool call
lifecycles become stable action parts, and tool results are collapsed back into
the action part that produced them. `AxleMessage[]` remains the canonical model
conversation state; turns do not affect model input or tool routing.
Model and provider failures are retained on the agent turn as `turn.error`, so
accumulated and restored render state includes the terminal error message.

The Agent holds no turns: it emits events, and whoever wants a transcript
folds and stores them. Attach a `TurnAccumulator`, persist its `state`
alongside `agent.snapshot()`, and re-seed it on restore
(`new TurnAccumulator(savedState)`). Compaction (see below) appears in the
fold as an ordinary `compaction` part; renderers that don't handle that part
type simply render nothing for it.

Hosts that transport Axle events over SSE, WebSockets, or another mixed event
stream can use `TurnAccumulator` instead of reimplementing this reducer:

```typescript
import { TurnAccumulator, type Annotation } from "@fifthrevision/axle/ui";

type AppAnnotation =
  Annotation<{ image: string }, "sandbox"> | Annotation<{ score: number; passed: boolean }, "eval">;

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

`StreamEvent` types: `turn:start`, `turn:complete`, `tool-results:start`,
`tool-results:complete`, `text:start`, `text:delta`, `text:citation`,
`text:end`, `citation`, `thinking:start`, `thinking:delta`,
`thinking:summary-delta`, `thinking:update`, `thinking:end`, `tool:request`,
`tool:args-delta`, `tool:exec-start`, `tool:exec-delta`, `tool:exec-complete`,
`tool:exec-error`, `provider-tool:start`, `provider-tool:complete`, `error`.

Tool and provider-tool events correlate by `id`. Text and thinking parts
stream sequentially within a turn, so their deltas belong to the most
recently opened part.

The `turn:complete` and `tool-results:complete` events carry complete
`AxleAssistantMessage` and `AxleToolCallMessage` objects for client-server
architectures that need authoritative message boundaries.

`StreamHandle.onToolBatchComplete(callback)` installs one awaited callback
after a complete tool batch has executed and its tool-result message has been
committed:

```typescript
const handle = stream({ provider, model, messages, tools });

handle.onToolBatchComplete(async (toolResultsMessage) => {
  await persist(toolResultsMessage);
  return shouldHandoff() ? "finish" : "continue";
});
```

Return `"finish"` to resolve successfully without starting another provider
request, or `"continue"` to resume the tool loop. The callback receives one
`AxleToolCallMessage` containing the whole batch; it is an awaited control
boundary, not a synthetic stream event. Agent uses this hook internally for
`stop()`.

### Compaction (experimental)

Compaction replaces the agent's active conversation with a shorter one — for
example a summary — so long sessions can continue past the model's context
limit. The API is experimental and may change in any release.

Axle ships a prompt-based implementation for the common case:

```typescript
import { PromptCompactor } from "@fifthrevision/axle";

const compactor = new PromptCompactor({
  provider,
  model,
  prompt:
    "Create a continuation summary. Preserve decisions, constraints, completed work, and open tasks.",
  thresholdTokens: 100_000,
  targetTokens: 20_000,
});

agent.setCompaction({
  shouldCompact: compactor.shouldCompact,
  compact: compactor.compact,
  triggers: {
    beforeTurn: true,
  },
});

const applied = await agent.compact(); // true when a compaction applied, false when declined
```

Compaction is split into three layers, each with one job. `triggers` say
*when to ask*: omitting them makes compaction manual-only; `beforeTurn` asks
at the start of the next `send()`'s turn, `afterTurn` after the model work of
a successful turn, before it settles. `shouldCompact` says *whether* — it is
consulted at every boundary, including manual (`ctx.trigger` is the input;
"a manual request always compacts" is `PromptCompactor` policy, not an engine
rule), and a `false` is the only silent path: nothing emitted, nothing ran.
Omitting `shouldCompact` means always-willing. `compact` does *the work* and
always returns `{ messages, summary? }` — the complete new conversation, plus
an optional reader-facing summary for the transcript — there is no decline
return; failures throw. The `summary` is a presentation choice, independent
of the model-facing messages: it can be the summary text itself, or something
else entirely ("Reduced the context by 50%"); omitted, the compaction part
renders as a bare divider.

Once `shouldCompact` says yes, the compaction is ordinary fallible turn work,
streamed like a tool call: a `running` compaction part lands in the natural
turn — head of the send's turn for `beforeTurn`, tail for `afterTurn`, its
own engine-opened turn for `manual` — `ctx.emit(...)` streams progressive
summary text onto it (liveness for long summarizations, and real traffic for
idle-timeout-prone transports), and it settles `complete` or `error`.
**Failures are non-fatal for automatic triggers**: the errored part is the
record, and the send continues on the uncompacted conversation — if that
genuinely overflows the context, the provider failure surfaces as the turn's
model error. A failed `manual` compact rejects, since it was explicitly
requested. `agent.compact({ signal })` follows the same cancellation contract
as every other operation: aborting rejects with an error whose `name` is
`"AbortError"`.

`PromptCompactor` returns two user messages: a model-written summary, and an
appendix of the latest 10 user messages in oldest-to-newest order. The target
is an approximate budget for both together. Set `recentUserMessages` to change
the count. If the appendix must shrink, older recent messages are removed
first. It returns the summary text as the part's reader-facing `summary`,
and both messages are stamped via metadata
(`axleCompaction: { id, role: "summary" | "appendix" }`, see
`CompactionStamp`). The stamp is a compactor-side convention — it is how the
compactor recognizes its own prior output, so carried-over messages are
excluded from the appendix and repeated compactions never re-collect an
earlier summary as a "recent" user message. The engine does not read stamps;
custom `CompactionCallback`s that don't stamp are valid.

Like tool callbacks, the compaction callbacks run while the agent's scheduler
is held: scheduling more work on the same agent from inside them queues behind
the current operation, so awaiting that work from inside a callback
deadlocks. Fire-and-forget scheduling is safe — the work runs after the
current operation settles.

Compaction is destructive at the message layer: the returned messages become
the entire active conversation, and the old messages cease to exist the
moment the part settles `complete` (settle ⇔ applied, atomically). Hosts
wanting the pre-compaction messages (undo, audit) copy them in their own
wrapper before returning. Compaction runs on the agent's work queue, so it
never interleaves with in-flight Agent work. `agent.context()` returns the
current `ContextUsage` estimate if you want to decide outside the callbacks.

The normative design — invariants, rationale, and rejected alternatives —
lives in [docs/architecture/compaction.md](docs/architecture/compaction.md)
and [docs/architecture/agent-state.md](docs/architecture/agent-state.md).
See [Migrating to Axle 0.30.0](docs/0.30.0-migration.md) for the turn
ownership and compaction protocol changes.

### Hosting / Sessions

Axle stops at the agent runtime boundary. If you need long-lived sessions,
SSE transport, resumable cursors, or React client hooks, build those concerns
in your host application on top of `Agent`, `agent.on(...)`, and the streamed
turn events that Axle emits.

To persist and resume an agent, snapshot it and construct a new agent with the
session. The snapshot is the pure continuation (`{ sessionId, messages }`) —
persist your tape's state next to it if you want the transcript back:

```typescript
const session = await agent.snapshot(); // waits for in-flight work to settle
const transcript = tape.state;
// ...store both, then later:
const resumed = new Agent(config, session);
const resumedTape = new TurnAccumulator(transcript);
resumed.on((event) => resumedTape.apply(event));
```

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

For first-party providers, the CLI supplies a model when one is omitted:
`openai/gpt-5.4-mini`, `anthropic/claude-haiku-4-5`, or
`google/gemini-3.5-flash`. Configure `provider.model` to override it.

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
