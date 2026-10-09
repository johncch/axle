# Terminology

Names in Axle are load-bearing: they appear in event types, span names,
option names, and host code. This document is normative — code, docs, and
events use these words with exactly these meanings. When a change would
introduce a new unit of work or state, name it here first.

## The three strata

Axle processes a conversation at three layers. Most terminology confusion
comes from mixing units across them.

| Layer     | Unit    | Contains                  | Lives at                         |
| --------- | ------- | ------------------------- | -------------------------------- |
| Wire      | Message | content parts             | `agent.messages`                 |
| Execution | Step    | one request + its fallout | the `send()` loop (`providers/`) |
| Render    | Turn    | parts (+ annotations)     | the host's `Transcript`          |

One `send()` = one or more **steps** of the execution loop, producing one
user **turn** and one agent **turn** built from streamed events, carried on
the wire as **messages**.

## Terms

**Message** — the wire-layer unit: a role-tagged (`user` / `assistant` /
`tool`) `AxleMessage` whose `content` is a list of parts. Messages are what
providers consume and what compaction rewrites. "Message" never refers to
render state or to host-level chat input.

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
steps). One exception to "one provider request": when Anthropic pauses a
response (`pause_turn`), the adapter sends the follow-up requests itself, and
the step still yields one assistant message and counts once toward
`maxSteps`.

**Turn** — the render-layer unit only: one conversation entry in a transcript — a
user turn or an agent turn. One send produces one user turn and one agent
turn; the agent turn accumulates parts from every step of that send. Turns
can also be started or ended by compaction: a manual compaction opens and
closes its own agent turn around the compaction part. "Turn" never refers
to a single assistant message or to a provider request.

**Send** — the Agent API verb: one scheduled conversation exchange
(`agent.send(...)`), executed as a FIFO queue item. The host-facing unit of
"the agent took its turn."

**Operation** — a queued unit of agent work that opens a turn: a Send or a
manual compaction. Operations run one at a time in FIFO order. An operation
is _pending_ from the call until its turn opens, and _settles_ when that
turn ends; `agent.onSettled(...)` then hands the host the session. Work that
opens no turn (`agent.snapshot()`) is queued the same way but is not an
operation.

**Skill** — a unit of on-demand instruction in the Agent Skills format: a
`SKILL.md` (frontmatter `name` and `description`, Markdown body) with
optional bundled files. In core a `Skill` is plain data — name, description,
`instructions`, an opaque `root`, a `files` listing — disclosed in the system
prompt as a _catalog_ line and _activated_ when the model calls `view-skill`.
A skill is not a tool: it adds instructions, and reaches files only through
the tools the host registered.

**Transcript** — the host-owned, reader-facing fold of `TurnEvent`s into turns
and annotations. The exported `Transcript` class is the shipped in-memory
implementation; hosts persist its `turns` and pass them to the constructor on
restore. The constructor shallow-copies that array, and the public `turns`
view is readonly; structural changes go through `apply`. Its `pending` view
holds operations the Agent has accepted but not started; that is live state
and is never saved. The Agent holds no
transcript — it emits events and keeps only the active `messages` (folded
working memory, bounded by compaction). Lose the turns, lose the transcript.

**Pending entry** — a placeholder for a turn the Agent has accepted but not
yet opened: a queued `send()` or a queued manual compaction. It is keyed by
the id its turn will carry and lives in `Transcript.pending`, never in
`turns`. It ends when that turn opens or when the operation is dropped
(cancelled, or failed during setup). Pending entries are live state: they are
not saved, and a transcript restored from saved turns has none.

**Session** — the continuable identity of a conversation (`sessionId`).
`AgentSession` is its serialized form — the pure continuation
`{ sessionId, messages }` that `agent.snapshot()` captures and the `Agent`
constructor restores. The transcript is not part of it; hosts persist its
state alongside.

**Compaction** — replacing the active conversation with a condensed
rewrite, recorded on the transcript as a `compaction` turn part carrying the
summary. Old messages cease to exist; lookback is served by the transcript.

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
definition, run an agent session, persist it.

**Verb** — a distinct machine composed on the kernel, selected by a
subcommand. Verbs select the machine; flags parameterize it — a mode is
never a flag.

**Session (CLI sense)** — the persisted continuation of one run:
`AgentDefinition` + core `AgentSession` + `Transcript.turns` + cwd, at
`~/.axle/sessions/cli/<id>.json`. Every run is a session, including each
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

**Host line** — renderer output that is not transcript: `info` / `success`
/ `warn` / `error` from the runner, drawn with the consola gutter. The
transcript channel renders the model's conversation; host lines frame it.

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
- **run** — host vocabulary: Sunnyday's durable conversation, one level
  above send. A run starts and stops per incoming message (state
  transitions, not sub-entities). Core never uses it as a unit name.
- **tape** — the pre-0.30 design term for the event fold. Rejected for the
  public object because it materializes reader-facing state rather than
  retaining a raw event log.
