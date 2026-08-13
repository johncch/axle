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
steps).

**Turn** — the render-layer unit only: one conversation entry in a transcript — a
user turn or an agent turn. One send produces one user turn and one agent
turn; the agent turn accumulates parts from every step of that send. Turns
can also be started or ended by compaction: a manual compaction opens and
closes its own agent turn around the compaction part. "Turn" never refers
to a single assistant message or to a provider request.

**Send** — the Agent API verb: one scheduled conversation exchange
(`agent.send(...)`), executed as a FIFO queue item. The host-facing unit of
"the agent took its turn."

**Transcript** — the host-owned, reader-facing fold of `TurnEvent`s into turns
and annotations. The exported `Transcript` class is the shipped in-memory
implementation; hosts persist its `turns` and pass them to the constructor on
restore. The constructor shallow-copies that array, and the public `turns`
view is readonly; structural changes go through `apply`. The Agent holds no
transcript — it emits events and keeps only the active `messages` (folded
working memory, bounded by compaction). Lose the turns, lose the transcript.

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
