# Axle

Axle is a TypeScript library for building multi-turn LLM agents. It provides a
small, focused API for building agentic applications.

**Documentation:** https://axle.fifthrevision.com

## Introduction

I built Axle while working on a command line AI task runner. I wanted a TypeScript-native library that would work across different inference providers.

It started as a workflow runner inspired by the composability of DSPy. As models got better with reasoning and tool use, many of the early abstractions, such as workflow shapes and explicit chain-of-thought constructs became unnecessary.

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

`agent.cancel(reason)` is the hard form of `stop()`: it cancels the active
operation immediately, exactly as that handle's own `cancel()` would, and
returns `false` when nothing is running. Queued operations are untouched and
the next one starts. Together: `stop()` ends the active turn at a tool
boundary, `cancel()` ends it now, and `clear()` drops what is queued.

Each `final` resolves only that handle's result: `h1` settles at the stop
boundary and does not absorb `h2`'s response. A stopped turn ends on its
tool-call exchange, so a plain send resolves with whatever text that turn
produced (often empty) and an Instruct send may resolve `ok: false` with a
parse error — no final answer exists yet by design.

Cancellation is handle-local, and the user message commits when its
`turn:user` event is emitted, after setup succeeds. Until then the send is
_pending_: `send()` emits `pending:queued` as soon as it is called, and a
send that ends before its turn opens emits `pending:dropped` (see
[Pending operations](#pending-operations)). Cancelling a queued handle
or a running handle during setup removes it without committing its user
message. Once `turn:user` is emitted, the committed message remains and the
agent turn is marked cancelled. This includes cancellation during
`beforeTurn` compaction: compaction is ordinary work inside the already-open
turn and cancellation does not unwind the transcript or active conversation. Other
queued handles continue. `stop()` never interrupts a running provider request
or tool batch; use cancellation when a hard stop is required.

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

Every factory takes the same client options, applied when the client is
built rather than per request:

```typescript
const provider = chatCompletions("https://gateway.example.com/v1", {
  apiKey: process.env.GATEWAY_API_KEY,
  maxRetries: 2, // retries after the first attempt; 0 disables
  timeoutMs: 60_000, // per attempt; omit for the SDK default (chatCompletions: 10 minutes)
  headers: { "X-App-Name": "my-app", "X-App-Version": "1.4.0" },
});
```

`headers` are passed straight to the SDK's default-header option, and on
ChatCompletions they are added after Axle's own `Content-Type` and
`Authorization`. Axle does not reserve any header name, so a caller-supplied
`Authorization` replaces the one derived from the API key on every provider.

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

`generate()` is the same request and the same tool loop with the non-streaming
return shape: it resolves the handle's `final` directly as a promise. The
transport underneath is always streaming, so the two never differ in what
they send or what they return:

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

Two options bound the tool loop. `maxSteps` caps the number of model requests;
`maxContextTokens` caps the context budget, checked after each step's tools are
answered against that step's reported usage (effective input + output).
Crossing either limit is a stop, not an error: the loop returns `ok: true` with
everything accumulated so far and `stopped` set to `"max-steps"` or
`"token-limit"`. The caller decides what happens next — e.g. compact the
conversation and start a new call. Non-positive limits throw at call time.

`sessionId` names the conversation a call continues. Providers that route or
group by session use it (OpenRouter's `session_id`); the rest ignore it.
`Agent` passes its own.

### Reasoning

`reasoning` is the one portable control over provider thinking. It is
accepted by `Agent`, `generate()`, `stream()`, and `PromptCompactor`:

```typescript
type ReasoningSetting =
  "default" | "off" | "on" | { effort: "low" | "medium" | "high"; display?: "visible" | "hidden" };

await generate({ provider, model, messages, reasoning: { effort: "high" } });
```

| Setting               | Meaning                                                                                                                                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| omitted / `"default"` | No reasoning fields are sent; the model runs at its provider default                                                                                                                                                                                             |
| `"off"`               | The provider's explicit disable. Models that cannot turn thinking off (Fable, Gemini 3, Gemini 2.5 Pro) reject the request                                                                                                                                       |
| `"on"`                | Same as `{ effort: "medium" }`                                                                                                                                                                                                                                   |
| `{ effort }`          | A named level on modern models, or a fixed token budget (2,048 / 8,192 / 16,384) on models that only accept budgets                                                                                                                                              |
| `{ effort, display }` | `"visible"` (default) asks the provider to disclose its thinking; `"hidden"` asks it not to, and Axle withholds thinking from the transcript on every provider. On Anthropic the server also skips streaming thinking tokens, improving time to first text token |

Effort is relative within a model, not comparable across models. `"on"`
enables reasoning but does not guarantee a visible thinking block on every
response. `display` controls whether thinking is disclosed, not its form:
Anthropic, OpenAI, and Gemini return a summary, open-weight models return
raw text, and chat-completions endpoints have no request field for it;
under `"hidden"` their thinking stays on the message but never reaches the
transcript. Axle does not validate support: an unsupported
combination comes back as a provider error. Anything beyond these levels,
such as `xhigh`, an exact budget, or an OpenAI summary length, goes through
`providerOptions`, which is applied after the portable mapping and overrides
it.

Anthropic needs an output cap on every request. When you don't pass
`maxOutputTokens`, Axle sends 128,000 (64,000 for Haiku 4.5, Opus 4.5, and
Sonnet 4.5) on `stream()`, `generate()`, and `Agent` alike. The per-provider translation is
documented in `docs/architecture/reasoning.md`.

### Results

`generate(...)`, `stream(...).final`, and `agent.send(...).final` all resolve
to a two-state result:

```typescript
if (!result.ok) {
  result.error.kind; // "model" | "refusal" | "parse"
  result.error.message; // present for every error kind
  return;
}

result.response; // always present when ok is true
result.stopped; // "max-steps" | "token-limit" when a loop limit ended the run
```

For `generate()` and `stream()`, plain calls return the final assistant message.
For `Agent.send("...")`, plain calls return the assistant text. `Instruct`
calls return the parsed schema value. Model, refusal, and parse failures
return `ok: false`; abort, fatal tool, configuration, and unexpected execution
errors still throw.

A `model` failure means the provider failed the request. `type` is
`"authentication"` when the provider rejected the API key or token, on every
provider; otherwise it is the provider's own error type. `status` is the HTTP
status when the failure was an HTTP response, and `raw` is the SDK error or
the response body as the provider produced it.

```typescript
if (!result.ok && result.error.kind === "model") {
  result.error.type; // "authentication", or the provider's own type
  result.error.status; // 401, 429, 500, ... when the failure was an HTTP response
  result.error.raw; // the SDK error, or { status, body } from a Chat Completions endpoint
}
```

A `refusal` failure means the provider declined the request or blocked its
output: Anthropic's `refusal` stop reason, an OpenAI refusal or content
filter, a Gemini safety block, or a Chat Completions `refusal` or
`content_filter`.

```typescript
if (!result.ok && result.error.kind === "refusal") {
  result.error.text; // the provider's refusal text or explanation, if it gave one
  result.error.category; // the provider's reason, e.g. "cyber", "SAFETY", "content_filter"
}
```

The refused step is not added to `result.messages` or to an agent's history,
and an `Instruct` call returns the refusal rather than a parse failure. A
refusal the model writes as ordinary text is not marked by any provider and
is a normal `ok: true` answer. After an Anthropic refusal, sending the same
conversation again is likely to be refused again; rephrase or remove the
refused message, or switch models.

Cancellation follows standard JavaScript abort semantics:

- `handle.cancel(reason)` aborts that stream or send handle only.
- A cancelled Agent handle commits no user turn unless its `turn:user` event
  was already emitted. After that point the committed user turn remains and
  the agent turn is marked cancelled, including when cancellation occurs
  during `beforeTurn` compaction before a provider request is made.
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

### Skills

A skill is a folder in the [Agent Skills](https://agentskills.io) format: a
`SKILL.md` with `name` and `description` in its frontmatter and instructions
in its body, plus any `scripts/`, `references/`, or `assets/` beside it.
Skills written for Claude Code or other compliant clients load unchanged.

```typescript
import { Agent, loadSkill } from "@fifthrevision/axle";

const pdf = await loadSkill("./skills/pdf");

const agent = new Agent({
  provider,
  model,
  tools: [readFile, exec], // your tools reach the skill's files
  skills: [pdf],
});
```

Disclosure is progressive. The Agent appends a catalog to the system prompt
(one line per skill: name and description) and registers a `view-skill` tool
whose `name` argument is an enum of the loaded skills. When the model decides
a skill applies it calls the tool and receives the instructions wrapped in
`<skill_content>` tags, with the skill directory and a listing of its files
so relative paths in the body resolve. Reading those files and running
scripts is done with whatever tools you gave the agent. No skills means no
catalog and no tool.

A `Skill` is plain data, so storage is yours to choose. `loadSkill(dir)` is
the filesystem convenience; `parseSkillMarkdown(text)` parses a `SKILL.md`
from anywhere, and you set `root` to whatever base your tools accept and
`files` to the names under it:

```typescript
const pdf: Skill = {
  ...parseSkillMarkdown(await getObjectText("s3://acme-skills/pdf/SKILL.md")),
  root: "s3://acme-skills/pdf",
  files: ["scripts/merge.py", "references/forms.md"],
};
```

A skill with neither `root` nor `files` is instructions only. In an
`AgentDefinition`, skills are name references (`skills: [{ name: "pdf" }]`)
that your resolver turns back into `Skill` objects, the same way tools work.

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
      provider: anthropic(apiKey),
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

| Name             | Anthropic                 | OpenAI             | Gemini          |
| ---------------- | ------------------------- | ------------------ | --------------- |
| `web_search`     | `web_search_20260318`     | `web_search`       | `googleSearch`  |
| `code_execution` | `code_execution_20260521` | `code_interpreter` | `codeExecution` |

You can also pass provider-specific names directly. Use the optional `config`
field for provider-specific options:

```typescript
{ type: "provider", name: "web_search", config: { max_results: 5 } }
```

These are the versions each Axle release was tested with; they do not follow
the provider's latest. `config` is merged into the provider's tool definition
last, so `config.type` pins another version:

```typescript
{ type: "provider", name: "web_search", config: { type: "web_search_20250305" } }
```

On Anthropic, Axle sends `allowed_callers: ["direct"]` with `web_search`, so
Claude calls the search itself and every result reaches the context. To let
Claude filter results with code before they reach the context (Anthropic's
dynamic filtering, Claude 4.6 and later), override it:

```typescript
{
  type: "provider",
  name: "web_search",
  config: { allowed_callers: ["code_execution_20260120"] },
}
```

A provider tool call is stored as a `provider-tool` part with the same
fields on every provider:

```typescript
{
  type: "provider-tool",
  id: "srvtoolu_01…",
  name: "web_search",
  input: { type: "search", queries: ["anthropic homepage"] },
  result: { type: "success" },
  continuity: { provider: "anthropic", call, result },
}
```

| Field        | Meaning                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`       | Axle's tool name: `web_search`, `web_fetch`, `code_execution`, `file_search`                                                                                                    |
| `input`      | What the tool was asked to do: `search` (`queries`), `open` (`url`), `find` (`url`, `pattern`), `code` (`code`), `command` (`command`). Absent for a tool Axle has no shape for |
| `result`     | `{ type: "success" }` or `{ type: "error", error }`. Absent while the tool has not run in that message                                                                          |
| `continuity` | The provider's own objects, typed with its SDK types and sent back only to that provider                                                                                        |

Render from `name`, `input`, and `result`. `continuity` is for sending the
call back and for provider-specific detail: Anthropic's search results are
`continuity.result.content`; OpenAI's item is `continuity.item` and carries
no search results; OpenAI's code interpreter stdout is in
`continuity.item.outputs`, which Axle asks for with `include`; Gemini's
code execution keeps its `executableCode` and `codeExecutionResult` parts
in `continuity.parts`, and the stdout is
`continuity.parts[1].codeExecutionResult.output`.

Provider tool events stream as `provider-tool:start`, `provider-tool:input`,
and then `provider-tool:complete` or `provider-tool:error`. They carry the
same `name` and `input`, and no provider objects. `provider-tool:input` fills
`detail.input` on the turn's provider-tool action; it fires before the search
runs on Anthropic and together with the result on OpenAI.

`provider-tool:error` replaces `provider-tool:complete` when the provider
reports that its tool failed, and the turn's action settles as `error`.

| Provider   | What counts as a failure                                    | `error.type`                                          |
| ---------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| Anthropic  | A result block whose `content` has an `error_code`          | Anthropic's `error_code`, such as `max_uses_exceeded` |
| OpenAI     | A tool item whose `status` is `failed`                      | `failed`; OpenAI gives no code                        |
| Gemini     | A `codeExecutionResult` whose `outcome` is not `OUTCOME_OK` | Gemini's `outcome`, such as `OUTCOME_FAILED`          |
| OpenRouter | Nothing: it does not report a failed search                 | —                                                     |

On Anthropic, `code_execution` maps to the current programmatic version.
Claude works in a container and reports each step as its own server tool:
`bash_code_execution` runs a command and `text_editor_code_execution` views,
creates or edits a file. Each arrives as a `provider-tool` part under that
name, the bash call with a `command` input and the text editor call with no
`input`. Pin `code_execution_20250825` through `config.type` to get a single
`code_execution` call carrying the code instead.

On Gemini, a provider tool next to your own tools needs Gemini 3 or later:
Axle sets `includeServerSideToolInvocations` for the combination, and Gemini
2.5 rejects it regardless.

Gemini names the queries it ran only when the answer ends, so its
`web_search` part comes after the text, and its three events fire together
at the end. It has no `continuity`: Gemini needs nothing sent back for a
search. OpenRouter reports a search only through citations, so it produces no
provider-tool part and no provider-tool events.

When Claude calls an Anthropic-run tool and one of your tools in the same
response, Anthropic runs its tool after your tool results come back. The
first assistant message then holds a `provider-tool` part with no `result`,
and the next one starts with a `provider-tool-result` part carrying the same
`id`. `provider-tool:complete` fires when that result arrives.

Anthropic can pause a long provider-tool turn (`pause_turn`). Axle continues
it automatically: the step keeps streaming, yields one assistant message, and
reports the summed usage of every request it took. A paused turn counts as one
step toward `maxSteps`.

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

On OpenRouter, an `Agent` sends its `sessionId` as the request's `session_id`,
so every request in a conversation routes to the same upstream provider and
keeps its prompt cache warm, and the requests are grouped under that id in the
OpenRouter dashboard. A host-chosen `sessionId` is sent as-is; OpenRouter
accepts up to 256 characters. Pass `sessionId` to `stream()` or `generate()`
to get the same without an agent, and set `providerOptions.session_id` to
send a different key.

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

`TurnEvent` types: `pending:queued`, `pending:dropped`, `turn:user`,
`turn:start`, `turn:end`, `part:start`,
`part:end`, `text:delta`, `text:citation`, `thinking:raw-delta`,
`thinking:summary-delta`, `thinking:update`, `action:args-delta`,
`action:running`, `action:input`, `action:progress`, `action:complete`,
`action:error`,
`action:child-event`, `compaction:update`, `compaction:complete`,
`compaction:error`, `annotation:start`, `annotation:update`,
`annotation:end`, `error`.

The `compaction:*` events mirror the action lifecycle: a compaction part
arrives `running` via `part:start`, `compaction:update` replaces transient
`summary` and `progress` fields, and exactly one of `compaction:complete` /
`compaction:error` settles it. Completion sets `progress` to `1` and its
returned summary replaces any transient summary.

`part:start` carries a `TurnPart`, discriminated by `part.type` (`"text"`,
`"thinking"`, `"file"`, `"citation"`, `"action"`, `"compaction"`). Action parts
further discriminate on `part.kind` (`"tool" | "agent" | "provider-tool"`).

Callbacks are registered once and fire on every subsequent `send()`, and also
receive the events of a manual `agent.compact()` (an engine-opened turn
wrapping the compaction part).

#### Transcript

`Turn` objects are accumulated render state. They are the snapshot counterpart
to `TurnEvent` streams: text deltas are folded into text parts, tool call
lifecycles become stable action parts, and tool results are collapsed back into
the action part that produced them. `AxleMessage[]` remains the canonical model
conversation state; turns do not affect model input or tool routing.
Model and provider failures are retained on the agent turn as `turn.error`, so
accumulated and restored render state includes the terminal error message.

The Agent holds no turns: it emits events, and whoever wants a transcript
folds and stores them. Attach a `Transcript`, persist its `turns` alongside
`agent.snapshot()`, and pass the saved turns to the constructor on restore.
Compaction (see below) appears in the fold as an ordinary `compaction` part;
renderers that don't handle that part type simply render nothing for it.

##### Pending operations

A send or a manual `agent.compact()` is an _operation_. The Agent runs one at
a time, so an operation requested during a turn waits. `Transcript` shows
that wait in `transcript.pending`, separate from `turns`:

```typescript
agent.send("Build the feature.");
agent.send("Also check the tests."); // queued behind the first

for (const entry of transcript.pending) {
  if (entry.kind === "send") renderQueued(entry.turn); // a preview user turn
  if (entry.kind === "compaction") renderQueuedCompaction();
}
```

Each entry carries the `id` of the turn it will open. `pending:queued` adds
it when the operation is accepted, including one that starts at once. It
leaves when that turn opens — the user turn for a send, the engine-opened
turn for a compaction — and the turn that arrives has the same id, so a
renderer can key a row by it and change its style in place. If the operation
ends first, `pending:dropped` removes it with a `reason`. The reason is
`{ type: "cancelled" }` for a cancelled handle, `agent.clear()`, or an
aborted signal, and `{ type: "error", error }` when setup failed.

Pending entries are live state. They are never part of `turns`, so saving
`turns` never saves them, and a `Transcript` restored from saved turns has
none. An operation still queued when the process exits is lost.

Hosts that transport Axle events over SSE, WebSockets, or another mixed event
stream can use `Transcript` instead of reimplementing this reducer:

```typescript
import { Transcript, type Annotation } from "@fifthrevision/axle/ui";

type AppAnnotation =
  Annotation<{ image: string }, "sandbox"> | Annotation<{ score: number; passed: boolean }, "eval">;

type HostEvent = { type: "run:terminal"; status: string };

const transcript = new Transcript<AppAnnotation, HostEvent>();

for await (const event of events) {
  const result = transcript.apply(event);

  if (result.handled === false) {
    // result.event is typed as HostEvent here
    applyHostEvent(result.event);
  }

  render(transcript.turns);
}
```

Use `@fifthrevision/axle/ui` for browser-safe presentation primitives. It
exports turns, annotations, turn events, and `Transcript` without importing
providers, MCP, tools, or other server-side runtime code.

`transcript.turns` is a readonly array and serves as both the read and
persistence surface. The constructor accepts a readonly array and makes a
shallow copy, so later changes to the supplied array do not alter the
transcript. The transcript accepts open event objects. Unknown host events, such as
`run:terminal` or `session:expired`, return `handled: false` and leave the
state unchanged. Annotations are embedded on their turn or part targets. The
transcript is not idempotent; callers should deduplicate replayed transport
events before applying them.

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

`StreamEvent` types: `step:start`, `step:complete`, `tool-results:start`,
`tool-results:complete`, `text:start`, `text:delta`, `text:citation`,
`text:end`, `citation`, `thinking:start`, `thinking:raw-delta`,
`thinking:summary-delta`, `thinking:update`, `thinking:end`, `tool:request`,
`tool:args-delta`, `tool:exec-start`, `tool:exec-delta`, `tool:exec-complete`,
`tool:exec-error`, `provider-tool:start`, `provider-tool:input`,
`provider-tool:complete`, `provider-tool:error`, `error`.

Tool and provider-tool events correlate by `id`. Text and thinking parts
stream sequentially within a step, so their deltas belong to the most
recently opened part.

The `step:complete` and `tool-results:complete` events carry complete
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
  summaryWords: 1_000,
  appendixTokens: 10_000,
  providerOptions: {
    reasoning: { effort: "medium" },
  },
});

agent.setCompaction({
  shouldCompactOnTrigger: compactor.shouldCompactOnTrigger,
  compact: compactor.compact,
  triggers: {
    beforeTurn: true,
  },
});

const applied = await agent.compact(); // true when applied; false when no compactor is configured
```

Compaction is split into three layers, each with one job. `triggers` say
_when to ask_: omitting them makes compaction manual-only; `beforeTurn` asks
at the start of the next `send()`'s turn, `afterTurn` after the model work of
a successful turn, before it settles. `shouldCompactOnTrigger` says whether
to accept an automatic request; a synchronous `false` is the only silent
automatic path: nothing is emitted and no id is allocated. A thrown policy
error propagates as a client implementation error. Omitting the policy means
every configured automatic trigger runs. Explicit `agent.compact()` bypasses
the policy and always invokes the configured compactor. `compact` does _the
work_ and always returns `{ messages, summary? }` — the complete new
conversation, plus an optional reader-facing summary for the transcript —
there is no decline return; failures throw. The `summary` is a presentation
choice, independent of the model-facing messages: it can be the summary text
itself, or something else entirely ("Reduced the context by 50%"); omitted,
the latest emitted summary remains, or the compaction part renders as a bare
divider if none was emitted.

Once an automatic policy accepts—or `agent.compact()` is called—the
compaction is ordinary fallible turn work, streamed like a tool call: a
`running` compaction part lands in the natural turn — head of the send's turn
for `beforeTurn`, tail for `afterTurn`, its own engine-opened turn for
`manual` — `ctx.emit({ progress, summary? })`
replaces transient reader-facing state on it (liveness for long
summarizations, and real traffic for idle-timeout-prone transports), and it
settles `complete` or `error`.
**Failures are non-fatal for automatic triggers**: the errored part is the
record, and the send continues on the uncompacted conversation — if that
genuinely overflows the context, the provider failure surfaces as the turn's
model error. A failed `manual` compact rejects, since it was explicitly
requested. `agent.compact({ signal })` follows the same cancellation contract
as every other operation: aborting rejects with an error whose `name` is
`"AbortError"`.

`PromptCompactor` returns a model-written summary and an appendix of up to
the latest 10 user messages in oldest-to-newest order, evicted oldest-first
to fit `appendixTokens` (default: a tenth of `thresholdTokens`; 0 keeps no
appendix). `summaryWords`
(default 1000) is a soft bound enforced by escalation, not by the request's
output cap: the prompt steers the size in words, the result is measured in
words, one relative-shrink rewrite runs if it lands over ~1.3× the request,
and word-boundary truncation is the last resort. The request sends no
output cap, so reasoning models think within the provider's own ceiling.
While
generating, the compactor reports estimated progress without exposing the
model's token stream, emits 100% immediately before completion, and leaves
the compaction part's optional reader-facing `summary` unset. Both messages
are stamped via metadata
(`axleCompaction: { id, role: "summary" | "appendix" }`, see
`CompactionStamp`). The stamp is a compactor-side convention — it is how the
compactor recognizes its own prior output, so carried-over messages are
excluded from the appendix and repeated compactions never re-collect an
earlier summary as a "recent" user message. The engine does not read stamps;
custom `CompactionCallback`s that don't stamp are valid.

The compactor accepts `reasoning` and `providerOptions` with the same semantics
as `Agent`, `generate()`, and `stream()` (see [Reasoning](#reasoning)); leaving
`reasoning` unset sends no thinking parameters, so the model runs at its
provider default. Use `providerOptions` for exact native controls such as a
thinking-token budget. The example above uses OpenAI's native reasoning shape;
other providers receive their own native options unchanged.

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
lives in [docs/architecture/compaction.md](../../docs/architecture/compaction.md)
and [docs/architecture/agent-state.md](../../docs/architecture/agent-state.md).
See [Migrating to Axle 0.30.0](../../docs/0.30.0-migration.md) for the turn
ownership and compaction protocol changes.

### Decisions (experimental)

A decision model answers typed questions about an input instead of
generating text. `decide()` sends one request and returns one typed answer
per question. There is no conversation, no tools, and no streaming.

```typescript
import { choice, decide, noul, score, typesafe } from "@fifthrevision/axle";

const result = await decide({
  provider: typesafe(process.env.TYPESAFE_API_KEY),
  model: "jev-latest",
  input: {
    customer_tier: "enterprise",
    ticket: "My checkout page shows a blank screen after I click Pay.",
  },
  questions: {
    is_bug: noul("Is the customer reporting a software defect?"),
    team: choice("Which team should own this ticket?", {
      payments: "Checkout, billing, or payment processing issues.",
      frontend: "Rendering, layout, or browser compatibility issues.",
      account: null,
    }),
    urgency: score("How urgent is this ticket?", [
      "Can wait for the next release",
      "Should be fixed this week",
      "Blocking revenue right now",
    ]),
  },
});

const { is_bug, team, urgency } = result.answers;

if (is_bug.type === "noul" && is_bug.noul >= 0.6) {
  // is_bug.noul is the probability of yes, 0 to 1
}
if (team.type === "choice") {
  // team.choice is "payments" | "frontend" | "account"
  // team.probabilities has one number per option; team.confidence is 0 to 1
}
if (urgency.type === "score") {
  // urgency.score is a position on the scale: 0 to 2 here, e.g. 1.99
  // urgency.legend maps "0" | "1" | "2" back to the level text
}
```

There are three question types, named as TypeSafe names them:

| Builder                          | Asks                          | Answer                                                        |
| -------------------------------- | ----------------------------- | ------------------------------------------------------------- |
| `noul(instructions, criteria?)`  | a yes/no question             | `{ type: "noul", noul }`                                      |
| `choice(instructions, criteria)` | which one of a set of options | `{ type: "choice", choice, probabilities, confidence }`       |
| `score(instructions, criteria)`  | where on an ordered scale     | `{ type: "score", score, probabilities, legend, confidence }` |

`criteria` describes the possible answers: `{ true, false }` text for a
noul (optional), a map of option to description or `null` for a choice, and
an array of levels, lowest first, for a score. `input` is a string, an
object, or an array.

Questions are a keyed map and answers come back under the same keys. When
the questions are written out as above, each answer is typed from its
question. When they are built at runtime (say, one noul per item in a list),
the keys are plain strings and each answer is any of the answer types.

Every answer is its own type or `{ type: "refusal" }`, so check `type`
before reading a value. TypeSafe never refuses; the variant exists for
providers that can decline a single question.

`decide()` throws on failure instead of returning a result with `ok`:

- `DECISION_REQUEST_FAILED` — the provider rejected the request;
  `error.details.status` and `error.details.body` carry the response.
- `DECISION_RESPONSE_INVALID` — the response body was not a decision result.
- `DECISION_ANSWER_MISMATCH` — a question came back unanswered or with a
  different answer type.

It also accepts `signal` to abort and `span` to trace under an existing span.
`result.usage` is the same `Stats` shape as elsewhere (`in`, `out`).

#### Decision providers

A decision provider is a separate kind of provider from the chat providers.
`typesafe()` cannot be passed to `stream()`, `generate()`, or an `Agent`,
and the chat providers cannot be passed to `decide()`.

```typescript
const direct = typesafe(process.env.TYPESAFE_API_KEY);

const viaOpenRouter = typesafe(process.env.OPENROUTER_API_KEY, {
  baseUrl: "https://openrouter.ai/api",
});
```

`typesafe()` reaches TypeSafe's Jev models. `baseUrl` sends the same request
to any host that serves TypeSafe's System One path; with OpenRouter, use an
OpenRouter key and either `jev-latest` or `~typesafe/jev-latest` as the
model. It takes the same client options as the other factories, with one
different default: `timeoutMs` is ten seconds per attempt, since a decision
normally answers in under a second.

Answers are not portable across models. A threshold tuned on one model
(`noul >= 0.6`) needs re-tuning on another, and `confidence` is each
provider's own measure.

The normative design lives in
[docs/architecture/decisions.md](../../docs/architecture/decisions.md).

### Model Catalog

Axle ships no table of models. A host that needs a model's context window,
output ceiling, capabilities, or price can look them up in the
[models.dev](https://models.dev) catalog through `ModelCatalog`, which keeps
a slimmed copy at a path you choose, or in memory:

```ts
import { ModelCatalog } from "@fifthrevision/axle";
import { homedir } from "node:os";
import { join } from "node:path";

const catalog = await ModelCatalog.open({
  cachePath: join(homedir(), ".myapp", "models.json"),
});
if (catalog.stale) void catalog.refresh(); // or await it — never throws

catalog.lookup("z-ai/glm-5.3-flash", { host: "openrouter" });
// → { id: "zhipuai/glm-5.3-flash", match: "host", model: {…}, cost: { input: 0.15, output: 0.5, cacheRead: 0.03 } }
catalog.lookup("claude-sonnet-5", { host: "anthropic" });
// → { id: "anthropic/claude-sonnet-5", match: "host", model: {…}, cost: {…} }
catalog.lookup("anthropic/claude-sonnet-5");
// → { id: "anthropic/claude-sonnet-5", match: "exact", model: {…} }   (no host: no price)
catalog.lookup("gemma4:26b-mlx");
// → { id: "google/gemma-4-26b-a4b-it", match: "prefix", model: {…} }
catalog.contextWindow("gemma4:26b-mlx");
// → { window: 262144, id: "google/gemma-4-26b-a4b-it", match: "prefix" }
catalog.lookup("something-unlisted"); // → undefined
```

`model` is a `CatalogModel`: `name`, `limit.context` / `limit.output`,
`reasoning`, `toolCall`, `structuredOutput`, `attachment`, `modalities`, and
`knowledge` cutoff. `cost` is per million tokens as that host charges it,
with `tiers` for models priced by request size (`{ size: 200000, input:
2.5, … }` applies to a request whose context exceeds 200,000 tokens).

The catalog has two layers. The canonical layer keys models by
`publisher/model`, independent of who serves them. The host layer keys each
models.dev provider's own ids (`anthropic`, `openrouter`, `togetherai`, …)
with that host's limits and prices, linked back to the canonical entry.
`lookup(model, { host })` tries the host's id first (for a first-party host,
`anthropic/claude-sonnet-5` also matches its `claude-sonnet-5`), then the
canonical key (a bare id is qualified with `publisher` if given), then a
best-effort match
for local runtimes' names — trailing build tags such as `-mlx` or `:q8_0`
dropped, punctuation and case ignored, publisher ignored, exact normalized
match first, else a unique prefix. The result's `match` and `id` say how it
was found, so a best-effort guess is visible. No match returns `undefined`;
what to assume then is yours.

`open()` reads the cache and never touches the network; without `cachePath`
the catalog lives in memory for the process. `stale` is true when there is
no cache or it is older than `maxAge` (default one day); when to act on that
is yours. `refresh()` always fetches both layers (about 0.4 MB and 0.5 MB
compressed), sends each layer's ETag so an unchanged file downloads
nothing, and keeps the cached copy on any failure, so an offline run is
never blocked; if only one layer fetched, the catalog stays `stale` so the
other is retried next time. `hosts: ["anthropic", "openrouter"]` keeps only those hosts
(the full host layer is about 1.9 MB on disk); `hosts: []` skips it.

### Hosting / Sessions

Axle stops at the agent runtime boundary. If you need long-lived sessions,
SSE transport, resumable cursors, or React client hooks, build those concerns
in your host application on top of `Agent`, `agent.on(...)`, and the streamed
turn events that Axle emits.

`agent.messages` exposes the active, model-facing conversation as a copy —
requests are built from it, and compaction replaces it. Read it for inspection
or to drive your own persistence; mutating the returned array has no effect.

To persist and resume an agent, snapshot it and construct a new agent with the
session. The snapshot is the pure continuation (`{ sessionId, messages }`) —
persist your transcript's turns next to it if you want the transcript back:

```typescript
const session = await agent.snapshot(); // waits for in-flight work to settle
const turns = transcript.turns;
// ...store both, then later:
const resumed = new Agent(config, session);
const resumedTranscript = new Transcript(turns);
resumed.on((event) => resumedTranscript.apply(event));
```

`snapshot()` waits behind everything already queued, so with several sends
queued it resolves after the last of them. To save as each one finishes,
register `onSettled` instead:

```typescript
agent.on((event) => transcript.apply(event));
agent.onSettled(async (session, operation) => {
  await save(session, [...transcript.turns]); // read both here: they match
  if (operation.result.status === "rejected") report(operation.result.reason);
});
```

It fires once after every send or manual compaction that ran, however it
ended: after its `turn:end` when it opened a turn, and before the
operation's handle settles. `session` is the same value `snapshot()`
returns. `operation` is a `SettledOperation`: its `kind` (`"send"` or
`"compaction"`) and a `result` that is exactly what the handle is about to
settle with — `{ status: "fulfilled", value }` with the `AgentResult` (or
`true`/`false` for a compaction), or `{ status: "rejected", reason }` with
the error. A send cancelled while still waiting in the queue never ran and
does not fire; a send that started and failed before committing its message
does, with a rejected result and an unchanged session.

The Agent waits for the callback. Return a promise when the work has to
finish before the next queued operation starts: the handle does not settle
and the next operation does not begin until every callback has settled, so
the transcript read inside the callback agrees with `session.messages` and
nothing from the next turn is visible before your callback resolves.
Callbacks run together, not in order. A callback that starts async work
without returning its promise does not hold the queue. Do not await
`send()`, `compact()` or `snapshot()` on the same agent inside the
callback: it holds the queue they wait for, so the nested call deadlocks.

The operation is already over while callbacks run: `agent.cancel()` and
`agent.stop()` return `false` in that window, and the callback is given no
signal — cancel your own work your own way. A callback cannot affect the
operation it reports on: if it throws or rejects, the error is recorded on
the trace as a warning, the remaining callbacks still run, and the handle
settles with its real result. Handle your own save failures inside the
callback. Like `on`, it returns a function that unregisters it.

## Known Limitations

1. Axle does not support multi-modal output right now.
