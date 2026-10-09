# Agent state: the continuation and the transcript

**Status**: current · **Last design revision**: 2026-10-08 (0.34.0)

This document is normative for how conversation state is owned and
persisted. Code and tests are built against it; divergence is a defect.
Vocabulary is defined in [terminology.md](../terminology.md).

## Invariants

1. **The Agent is a continuation, not a record.** `AgentSession =
{ sessionId, messages }` — the session id and the active model-facing
   conversation, nothing else. `agent.snapshot()` returns exactly this;
   `new Agent(config, session)` restores it. Unknown keys in stored
   sessions are ignored.
2. **The Agent holds no transcript.** It emits `TurnEvent`s; whoever wants
   a transcript folds them with the shipped in-memory `Transcript` and stores
   its turns. Lose those turns, lose the transcript — the Agent cannot recreate
   it. Internally the Agent keeps only a turn-scoped fold to build
   `result.turn`, discarded when the operation settles.
3. **The event stream is the only channel between engine and transcript.** Hosts
   attach with `agent.on(...)`; there is no injected store, no engine-side
   read-back, no `session:restore` event. Restore means the host re-seeds
   its own transcript (`new Transcript(savedTurns)`) from its own copy,
   persisted next to the `AgentSession` in one atomic write.
4. **Historical messages are disposable.** Compaction replaces `messages`
   and the old ones cease to exist. Lookback is served by the transcript; hosts
   wanting pre-compaction messages (undo/fork, exact-request audit) copy
   them themselves before returning from their compactor.
5. **A user message commits together with its turn event.** Once `turn:user`
   is on the wire, the message is in the conversation — transcript and messages
   cannot diverge. Nothing is committed before genuine setup (such as MCP
   resolution) succeeds; until then the send is only a pending entry
   (invariant 7), which commits nothing. `Agent.send()` clones and validates
   its `Instruct` and materializes the `AxleUserMessage` and its user turn
   synchronously before scheduling; execution emits that same turn as
   `turn:user`, then the same `Instruct` parses the final assistant response.
6. **Usage accounting is host-domain.** Every `turn:end` carries
   `turn.usage`; hosts accumulate totals in their own storage. The Agent
   exposes no usage meter, and `AgentSession` carries none.
7. **Pending is live state, kept apart from turns.** An operation — a send
   or a manual compaction — is announced with `pending:queued` when the
   Agent accepts it, carrying the id of the turn it will open. `Transcript`
   holds it in `pending`, never in `turns`, and removes it when a turn with
   that id opens (`turn:user` for a send, `turn:start` for a compaction) or
   when `pending:dropped` arrives. A drop means the operation ended before
   opening its turn and committed nothing: `cancelled` for a handle cancel,
   `clear()`, or an aborted signal; `error` for a failed setup. `turns` stays
   append-only. Pending entries are never persisted — the `Transcript`
   constructor cannot accept them, so a restored transcript has none — and
   `AgentSession` carries no queue. Work that opens no turn (`snapshot()`)
   is queued but never pending.
8. **The Agent hands over the session when an operation settles.**
   `agent.onSettled(...)` fires once for every operation that opened a turn,
   after that turn's `turn:end` and before the operation's handle settles,
   with the value `snapshot()` returns. The Agent is at rest and the next
   queued operation has not started, so a host that reads its
   `Transcript.turns` inside the callback holds turns and messages that
   match exactly. A dropped operation does not fire. The callback is its own
   channel: the session never rides the turn event stream, which hosts
   forward to clients. A callback reports an outcome and cannot change it:
   one that throws is caught, recorded on the trace, and does not stop the
   other callbacks or alter the handle's result. `snapshot()` remains the
   pull form and waits behind everything queued ahead of it.

## Design rationale (2026-08-12)

The Agent's two data structures have different mutation semantics and
therefore different owners. **Messages** are folded working memory: compaction
rewrites them, the past disappears from them by design, and the model needs
them hot on every request — they belong to the Agent, and they are bounded by
construction (compaction is the bound). **Turns** are an append-only fold of
the event stream — the chronological record of what happened. They are not a
projection of messages: messages lack timing, thinking, errors, aborted turns,
annotations, and child-agent detail, and post-compaction they lack the past
entirely. Turns are `fold(events)`, and the fold ships as `Transcript`.

The pre-0.30 `History` glued the two together inside the Agent, which was
neither-here-nor-there: the Agent didn't enforce coherence between them,
carried turns only as a convenience, yet paid unbounded growth and
serialization weight. The fix was a deletion: turns left the Agent entirely,
and the unused session-annotation target was removed rather than moved into
the transcript. Session-wide application state belongs to the host. Consumers
that already ran their own folds paid nothing; the engine stopped holding
state it didn't own.

Consequences that fall out of the split: a DB-backed transcript is just a
subscriber with storage (no shared axle interface until a second
storage-backed implementation wants one); compaction events are natural
chapter boundaries for hosts that rotate storage; and there is deliberately
no retrieval/paging API on the Agent — deep-history readers are host-storage
readers, exactly as they already are for messages.

Semantic memory follows the same ownership boundary. The Agent has no memory
service or automatic recall/record lifecycle. Model-directed retrieval and
writing are ordinary tools; deterministic host-directed context is supplied
through `Instruct.addContext()`. Complete transcript persistence consumes the
turn event stream instead of masquerading as semantic memory.

## Pending and settle (2026-10-08)

Hosts could not render work the Agent had accepted but not started. A send
made during an active turn was a closure in the scheduler until `turn:user`;
a queued manual compaction was the same; `clear()` and a cancelled handle
rejected a promise and emitted nothing. Hosts kept their own lists and could
not keep them correct, because no event tied a `turn:user` to its send.

The queue belongs to the Agent, so the Agent announces it. The fold belongs
to `Transcript`, so `Transcript` holds it. What made this hard was that
`turns` has always been append-only and durable, and a pending entry is
neither. The resolution was to stop trying to make one collection serve
both: `turns` is the record, `pending` is live state, and the persistence
contract (save `turns`, restore through the constructor) is unchanged and
discards pending by construction.

One rule covers every kind of operation: an entry is keyed by the id of the
turn it will open, and that turn opening is what resolves it. A send's turn
id is its message id, known at `send()`; a manual compaction's is chosen at
`compact()`. Adding a kind adds a variant and nothing else.

Saving had the mirror-image problem. `snapshot()` is at rest because it
queues, which means that with five sends queued a save requested after the
first one runs after the fifth. `onSettled` hands the session over at each
rest point instead of making the host wait in line for it, and it fires at
the one moment the host's transcript and the Agent's messages are known to
agree.

Accepted consequences:

- **Graceful shutdown is `clear()`, then `stop()` or `cancel()`, then
  `snapshot()`** (or the last `onSettled`). The order matters: `clear()`
  also cancels a queued `snapshot()`. Pending is empty at save time because
  it was cleared, and connected clients received the drops.
- **A crash, or a save taken while work is queued, loses the queued
  operations.** After restore the pending rows are gone and nothing recorded
  them — the same loss a mid-stream turn already had. A host that needs
  queued input to survive a restart keeps its own inbox, written on
  `pending:queued`.
- **A failed or cancelled manual compaction still fires `onSettled`** with
  unchanged messages. One redundant save buys a one-sentence rule.
- **An automatic compaction inside a send does not fire on its own.** It is
  part of that send, whose single firing includes it.

## Rejected alternatives

- **Host-side pending lists** (2026-10-08): the status quo. A host mirrors
  state the Agent owns, with no event linking a `turn:user` to its send and
  no signal from `clear()`.
- **Pending entries inside `turns` with a `queued` status** (2026-10-08):
  ordering works, since the queue is FIFO, but a dropped entry must be
  removed (ending append-only) or kept as a tombstone; `turn:user` would no
  longer mean the message is in the conversation; and saved data would
  contain pending rows that exist in no Agent queue after restore.
- **Pending in `AgentSession`, restored into a "held" state** (2026-10-08):
  a queued send is more than its message — output schema, file resolver,
  abort signal, and the handle someone awaits do not survive serialization.
  An Agent that re-ran them on construction would start provider calls with
  no handle; one that held them would keep an entry pending forever when the
  host never acted.
- **`Transcript.snapshot()` that filters pending** (2026-10-08): redundant
  once pending lives outside `turns`, and a second way to save that hosts
  could confuse with the first.
- **Putting the session on the turn event stream** (2026-10-08): hosts
  forward turn events to clients; the model-facing conversation would ship
  to the browser on every turn.
- **A callback after every event** (2026-10-08): messages change only when
  an operation settles; mid-turn they would be identical to the last firing
  or hold a user message with no reply.
- **Letting `snapshot()` jump the queue** (2026-10-08): changes what it
  means for every host — `send(); send(); snapshot()` is expected to include
  both sends.
- **Letting an `onSettled` throw propagate, or rethrowing it outside the
  operation** (2026-10-08): propagating replaces the result of a send whose
  messages are already committed, so a caller that retries sends the message
  twice. Rethrowing as an uncaught exception takes the process down with
  work still queued. A host handles its own save failures in its callback.
- **`onSnapshot` as the name** (2026-10-08): the pair with `snapshot()`
  invites reading it as "fires when `snapshot()` is called". The callback is
  named for the moment, `onSettled`.

- **Keeping `History.turns` as an in-RAM convenience mirror** (2026-08-12):
  a mirror that is neither serialized nor authoritative recreates the
  neither-here-nor-there problem at smaller scale.
- **`AgentSession.version`** (2026-08-12): duplicates host-side versioning
  (hosts already version their stored blobs); an incompatible shape change
  is an ordinary breaking release. Unknown-key tolerance replaces it.
- **`archive` (append-only message log in the Agent)** (2026-08-12): no
  readers existed; the transcript is a strict superset for lookback; retention is
  a host choice at the compaction boundary.
- **Injected transcript (`new Agent(new Transcript(), …)`)** (2026-08-12):
  the engine only ever writes to it — that is a subscriber with extra
  ceremony, and it falsely implies the Agent owns the transcript's lifecycle.
  The event stream is the channel designed for this. Revisit only if turn
  commit must await durable writes (WAL semantics), which no consumer wants.
- **`agent.sessionUsage` meter** (2026-08-12): usage fails the continuation
  test (instance-lifetime, resets on restore) and hosts already receive
  per-turn usage on `turn:end`.
- **Turn retrieval/paging API on the Agent** (2026-08-11): deep-history
  readers are host-storage readers; messages already work this way.
- **Injected semantic-memory lifecycle** (2026-08-12): automatic recall and
  record mixed prompt augmentation, persistence, tool registration, and
  failure policy into the Agent. Tools and host-supplied `Instruct` context
  cover the actual behaviors without a memory-specific runtime contract.
- **`CompiledUserTurn` intermediate** (2026-08-12): paired an already-rendered
  message with a response parser, but split knowledge of rendering and parsing
  outside `Instruct`. `Instruct` now owns validation, message materialization,
  and response parsing directly; the Agent schedules one cloned instruction.
