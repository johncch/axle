# Terminology

Names in Axle are load-bearing: they appear in event types, span names,
option names, and consumer code. This document is normative — code, docs, and
events use these words with exactly these meanings. When a change would
introduce a new unit of work or state, name it here first.

## The three strata

Axle processes a conversation at three layers. Most terminology confusion
comes from mixing units across them.

| Layer     | Unit    | Contains                  | Lives at                         |
| --------- | ------- | ------------------------- | -------------------------------- |
| Wire      | Message | content parts             | `agent.messages`                 |
| Execution | Step    | one request + its fallout | the `send()` loop (`providers/`) |
| Render    | Turn    | parts (+ annotations)     | the consumer's `Transcript`      |

One `send()` = one or more **steps** of the execution loop, producing one
user **turn** and one agent **turn** built from streamed events, carried on
the wire as **messages**.

## Who serves a request

A request names a model, speaks a protocol, and goes to a provider, which
may hand it to a host to run. Each word below names one of these layers and
nothing else.

| Term      | Example                            | Answers                        |
| --------- | ---------------------------------- | ------------------------------ |
| Model     | `anthropic.claude-sonnet-4-5-v1:0` | which weights, by this name    |
| Publisher | `anthropic`                        | who made the model             |
| Protocol  | `messages`                         | which wire format              |
| Provider  | `amazon-bedrock`                   | who serves and bills it        |
| Host      | Together, behind OpenRouter        | whose hardware ran the request |

**Model** — the model id as the provider names it, sent on the request and
recorded as the response reported it. The same weights carry different
model ids at different providers (`claude-sonnet-4-5-20250929` at
`anthropic`, `anthropic.claude-sonnet-4-5-v1:0` at `amazon-bedrock`).

**Publisher** — who trained and released the model, the first half of a
canonical `publisher/model` id in the model catalog. A model's publisher
never changes with where it is served.

**Protocol** — a wire format for requests and streamed responses:
`messages`, `responses`, `chatCompletions`, `generateContent`. Each has a
constructor of the same name that returns a provider speaking it.

**Provider** — the service that serves and bills a request, named by its
models.dev id (`anthropic`, `amazon-bedrock`, `openrouter`). In code, the
`AIProvider` an `Agent` takes: a protocol configured with a base URL, auth
and a dialect (the provider's deltas from the protocol: model id form,
capabilities, extension fields), carrying that id as `id`. A provider whose
service is unknown (a local server) has no `id`. Two providers can share an
`id` (Bedrock in two regions). Presets (`anthropic()`, `openrouter()`) are
shorthand for a protocol constructor with the configuration filled in.
Prices are per provider, so usage is priced by `id` and model.

**Host** — whose hardware ran a request, when that differs from the
provider: a router such as OpenRouter bills the request and forwards it to
a host. Axle does not record hosts; models.dev does not price by them.

**Consumer** — the application that embeds Axle (the CLI, Sunnyday). It
owns what Axle hands over: transcripts, sessions, usage totals.

## Terms

**Message** — the wire-layer unit: a role-tagged (`user` / `assistant` /
`tool`) `AxleMessage` whose `content` is a list of parts. Messages are what
providers consume and what compaction rewrites. "Message" never refers to
render state or to consumer-level chat input.

**Part** — the atomic content unit: text, thinking, tool-call, file,
citation. Parts are the shared vocabulary of the wire layer
(`AxleMessage.content`) and the render layer (`Turn.parts`); they are the
same concept at both. A subagent invocation is a tool-call part like any
other.

**Step** — one pass of the execution loop inside a `send()`: one provider
request, the assistant message it yields, and the tool batch that message
requests (if any). A send ends with the first step whose message requests
no tools, or when a budget (`maxSteps`, context limit) or boundary control
stops the loop. Steps are invisible in conversation state — each step's
output is flattened into messages and into the agent turn's parts. Spans are
named `step-N`; stream events are `step:start` / `step:complete`. This
matches the unit's industry usage (Vercel AI SDK `maxSteps`, OpenAI run
steps). Two exceptions to "one provider request": when Anthropic pauses a
response (`pause_turn`), the adapter sends the follow-up requests itself; and
when Gemini 4 stops at its per-request cap (`CONTINUATION`), the Gemini SDK
does. Either way the step still yields one assistant message and counts once
toward `maxSteps`.

**Tool batch** — the set of separate tool calls one assistant message
requests. Each call in a tool batch is validated, executed, and answered with
its own tool result. The calls run concurrently; the results answer in
request order (see `architecture/tool-loop.md`).

**Parallelized tool** — the single tool `parallelize(tool)` returns: one call
whose arguments carry an `items` array, each item run through the inner
tool's `execute` concurrently, with one ordered result. It is one tool call,
not a tool batch: its arguments are validated as a whole, so one invalid item
rejects the call. Not "batch tool".

**UsageEntry** — one row of `Stats.breakdown`: the usage of one provider
request, tagged with the provider and model that served it and, when the
`Agent` that made it has a `name`, with that name as `agent`. Rows are kept
in request order and never summed per model, because providers bill a request at
the tier its own prompt size selects; a row's `in` is that prompt size. A
subagent's rows sit between the parent requests that bracket its tool call,
under the subagent's own name; several subagents in one tool batch
interleave their rows in wall-clock order. A paused Anthropic response (`pause_turn`)
is one step but several requests, and yields one row per request. A Gemini 4
response continued past its per-request cap (`CONTINUATION`) is also several
requests but yields one row, because the SDK runs those requests and reports
their usage summed; that row's `in` is the sum of each request's prompt. Rows
explain the aggregate `in` / `out`; they are never added to them again.

**Turn** — the render-layer unit only: one conversation entry in a transcript — a
user turn or an agent turn. One send produces one user turn and one agent
turn; the agent turn accumulates parts from every step of that send. Turns
can also be started or ended by compaction: a manual compaction opens and
closes its own agent turn around the compaction part. A turn's `status`
runs `pending` → `streaming` → `complete` | `cancelled` | `error`; a user
turn skips `streaming`, and a `pending` turn lives only in
`Transcript.pending`. "Turn" never refers to a single assistant message or
to a provider request.

**Send** — the Agent API verb: one scheduled conversation exchange
(`agent.send(...)`), executed as a FIFO queue item. The consumer-facing unit of
"the agent took its turn."

**Operation** — a queued unit of agent work that opens a turn: a Send or a
manual compaction. Operations run one at a time in FIFO order. An operation
is _pending_ from the call until its turn opens, and ends when its turn
ends or, for a send with a continuation, when the continuation returns.
Every turn it commits _settles_: `agent.onSettled(...)` hands the consumer the
session and that turn's outcome, and waits for the consumer before anything
else runs. An operation cancelled while still queued never ran and does not
settle. `agent.snapshot()` opens no turn, is not queued, and is not an
operation.

**Continuation** — a program a send carries (`after` in its options) that
runs after the send's turn settles and before the queue moves on. It holds
the queue until it returns and can run _inline turns_ through its context.
It is attached to one send, is not queued, has no pending entry of its own,
and is never nested: an inline turn carries no continuation. It runs when
its turn resolved with a result, `ok` or not; a rejected turn (cancelled,
a fatal tool error, a setup failure) skips it. The word means only this;
the Agent's resumable state is the _session_.

**Inline turn** — a turn a continuation runs through `ctx.send()`. It is an
ordinary send turn in every way but one: it starts at once in the held
slot, so it has no pending phase and announces no `pending:queued`. It
commits to messages, settles through `onSettled` under its own id, and is
recorded on its operation's result under `after`. Inline turns run one at a
time, FIFO, like operations.

**Idle** — the Agent has no operation running and none queued. It is
_busy_ from the first call that schedules an operation until the last
queued one has settled; `agent.onIdle(...)` fires at each change from busy
to idle, and `agent.snapshot()` resolves there.

**Skill** — a unit of on-demand instruction in the Agent Skills format: a
`SKILL.md` (frontmatter `name` and `description`, Markdown body) with
optional bundled files. In core a `Skill` is plain data — name, description,
`instructions`, an opaque `root`, a `files` listing — disclosed in the system
prompt as a _catalog_ line and _activated_ when the model calls `view-skill`.
`agent.skills` is the `SkillRegistry` that holds them; like `agent.registry`
for tools, it changes at any time and the next provider request reads it.
A skill is not a tool: it adds instructions, and reaches files only through
the tools the consumer registered.

**Transcript** — the consumer-owned, reader-facing fold of `TurnEvent`s into turns
and annotations. The exported `Transcript` class is the shipped in-memory
implementation; consumers persist its `turns` and pass them to the constructor on
restore. The constructor shallow-copies that array, and the public `turns`
view is readonly; structural changes go through `apply`. Its `pending` view
holds operations the Agent has accepted but not started; that is live state
and is never saved. The Agent holds no
transcript — it emits events and keeps only the active `messages` (folded
working memory, bounded by compaction). Lose the turns, lose the transcript.

**Pending turn** — a preview of a turn the Agent has accepted but not yet
opened: the user turn a queued `send()` will commit, or an agent turn with
one `pending` compaction part for a queued manual compaction. It is a `Turn`
with `status: "pending"` and the id the real turn will carry, and it lives
in `Transcript.pending`, never in `turns`. It ends when that turn opens or
when the operation is dropped (cancelled, or failed during setup). Pending
turns are live state: they are not saved, a transcript restored from saved
turns has none, and a consumer seeds them through the constructor only to
mirror a live transcript.

**Session** — the continuable identity of a conversation (`sessionId`).
`AgentSession` is its serialized form — the pure continuation
`{ sessionId, messages }` that `agent.snapshot()` captures and the `Agent`
constructor restores. The transcript is not part of it; consumers persist its
state alongside.

**Compaction** — replacing the active conversation with a condensed
rewrite, recorded on the transcript as a `compaction` turn part carrying the
summary. Old messages cease to exist; lookback is served by the transcript.

**Failure** — the `ok: false` arm of a result: an `AxleProviderFailure`
of kind `api`, `incomplete`, `refusal`, or `parse`. A failure is always the provider's
answer to a request that went out. It is a value on a result, never
thrown.

**Rejection** — a handle or promise that throws an `AxleError`: a mistake
in the setup or the message, a local file that could not be read, a tool
that ended the run, a cancel, or a broken invariant. Nothing was sent, or
what was sent is carried on the error. The rule is in
[architecture/errors.md](./architecture/errors.md).

**Trace** — observability only: the span tree produced by the tracer and
consumed by span writers (`TraceWriter`, `LogWriter`). "Trace" never means
the conversation transcript.

**Display (reasoning)** — the request-side disclosure control on
`reasoning`: `display: "visible" | "hidden"`. It says whether the provider
should show its thinking, never in what form. The form that arrives, a
summary or raw text, is recorded on the thinking part and is the model's
property; "display" never names a summary length or a rendering choice.

**Summary / raw (thinking)** — the two content fields of a turn's thinking
part, each named for what the provider handed back: `summary` is the
provider's condensed account of its reasoning, `raw` is the chain of
thought itself (open-weight models only). Neither present is the withheld
state. The message-layer thinking part keeps the wire vocabulary (`text`,
`summary`, `redacted`) because it exists to be echoed, not read. Normative
in `docs/architecture/thinking.md`.

**Redacted (thinking)** — a wire-layer flag only: the provider substituted
an opaque payload for the content and wants it echoed on the next turn.
Never a turn-part or event field, and never set because thinking was
merely hidden.

**Decision** — one `decide()` call: an input and a set of typed questions
sent to a decision model in a single request, answered with one typed value
per question. A decision is not a step, a send, or a message: it has no
conversation and produces no turn. Normative in
`docs/architecture/decisions.md`.

**Decision model / decision provider** — a model that answers typed
questions and cannot generate text, and the `DecisionProvider` that reaches
it. Distinct from `AIProvider`; a provider may be either or both.

**Input (decision)** — the content every question in a decision is asked
about: a string or a JSON value. TypeSafe's wire name for it is `state`;
"state" in Axle means agent or session state, so the option is `input`.

**Question / answer (decision)** — a question is `noul`, `choice`, or
`score`, named by the caller's key; its answer comes back under the same
key. The three words are TypeSafe's and are used unchanged.

**Noul** — a yes/no question. Its answer `noul` is the probability of yes,
from 0 to 1. A value near 0.5 means the model is unsure, not that the answer
is "partly".

**Choice** — a question that picks one option from a set the caller
defines. Its answer carries the chosen option, a probability per option, and
a confidence.

**Score** — a question that places the input on an ordered scale the caller
defines, lowest level first. Its answer `score` is a probability-weighted
position on that scale, zero-based, and can fall between levels.

**Criteria** — the caller's description of a question's possible answers:
what yes and no mean for a noul, the options for a choice, the ordered
levels for a score.

**Confidence (decision)** — the provider's summary of how concentrated a
choice or score answer's probabilities are. It is not the probability of the
chosen answer, and it is not comparable across models.

**Refusal (decision)** — a provider declining one question in a decision.
The answer for that question is `{ type: "refusal" }`; the rest of the
decision stands. Unrelated to the chat-side `Refusal`, which describes a
declined request or blocked output.

## CLI vocabulary

The CLI layers its own units on top of the core terms; normative design in
[architecture/cli.md](architecture/cli.md).

**Recipe** — a job YAML file: a saved partial application of an invocation
(`axle(...recipe, ...argv)`). Everything the command line could say has a
home in the recipe; the command line overrides selectively. "Job" survives
in flag names (`-j`) and ledger keys as the recipe's runtime instantiation.

**Invocation** — one command-line call: a kernel invocation (bare `axle`,
`-j`, `-m`) or a verb invocation (`batch`, `resume`, `schedule`, `setup`,
`cleanup`).

**Kernel** — the session runner every invocation composes on: resolve a
recipe against the current configuration, run an agent session, persist
it.

**Verb** — a distinct machine composed on the kernel, selected by a
subcommand. Verbs select the machine; flags parameterize it — a mode is
never a flag.

**Session (CLI sense)** — the persisted continuation of one run: the
recipe's agent keys as written (`AgentRecipe`) + core `AgentSession` +
`Transcript.turns` + cwd, at `~/.axle/sessions/cli/<id>.json`. Everything
in the recipe file is written into the session; everything that is not is
resolved at runtime. Every run is a session, including each
batch item; `axle resume <id>` re-enters any of them.

**Ledger** — the project-local batch index (`.axle/batch.jsonl`): one
append-only record per item run, keyed (job, input) with a content hash and
session id. Read only under `--incremental`; always written.

**Schedule** — a recipe's declared recurrence (`schedule: { every }`) and,
once applied, its OS registration. Identified by the recipe's canonical
path; recorded at `~/.axle/schedules/<id>.json`. The recipe declares, the
registrar (a `ScheduleBackend`, macOS `launchd` only) holds the OS
artifact, and reconciliation keeps the two in line.

**Occurrence** — one scheduler-initiated run of a schedule: the same CLI
re-entered with the `--scheduled <id>` marker, taking the ordinary `-j`
path without reconciliation or prompts. Deliberately not "run" (Sunnyday's
term) or "firing" (the launchd event, before the CLI is involved).

**Trigger** — the parsed recurrence stored in a schedule record: an
interval (`every`, elapsed seconds) or a calendar (`at` times in local
time, optional `on` weekdays). The backend-neutral name for what a backend
maps to `StartInterval` or `StartCalendarInterval`.

**Binding** — the backend-specific half of a schedule record
(`{ kind: "launchd", label, plistPath }`), a versioned discriminated union
with one member per backend. Common fields never depend on it.

**Runs ledger** — the per-schedule append-only index
(`~/.axle/schedules/<id>.runs.jsonl`): one line per occurrence with start,
end, status, and the session ids it produced. Read by `schedule sessions`
and `schedule list`; distinct from the batch ledger, which is per project
and keyed by input.

**Runner line** — renderer output that is not transcript: `info` / `success`
/ `warn` / `error` from the runner, drawn with the consola gutter. The
transcript channel renders the model's conversation; runner lines frame it.

## Reserved and avoided words

- **iteration** — replaced by _step_. `maxIterations` is the pre-0.29 name
  for `maxSteps`. Rejected as the unit's name because it names the act of
  looping, not the thing produced — a step carries content (the assistant
  message); an iteration is an odometer tick.
- **round** — considered and rejected for the execution unit; _step_ won on
  industry alignment (Vercel `maxSteps`, OpenAI run steps).
- **turn** for an assistant message or provider request — the pre-0.29
  usage; renamed to _step_ (`StreamEvent`'s former `turn:start` /
  `turn:complete` collided with `TurnEvent`'s render-layer `turn:start`).
- **run** — consumer vocabulary: Sunnyday's durable conversation, one level
  above send. A run starts and stops per incoming message (state
  transitions, not sub-entities). Core never uses it as a unit name.
- **tape** — the pre-0.30 design term for the event fold. Rejected for the
  public object because it materializes reader-facing state rather than
  retaining a raw event log.
