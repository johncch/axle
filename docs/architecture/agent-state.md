# Agent state: the continuation and the transcript

**Status**: current · **Last design revision**: 2026-08-12 (0.30.0)

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
   cannot diverge. Nothing is committed or emitted before genuine setup
   (such as MCP resolution) succeeds. `Agent.send()` clones and validates its
   `Instruct` synchronously before scheduling; execution materializes the
   corresponding `AxleUserMessage` before opening the turn, then the same
   `Instruct` parses the final assistant response.
6. **Usage accounting is host-domain.** Every `turn:end` carries
   `turn.usage`; hosts accumulate totals in their own storage. The Agent
   exposes no usage meter, and `AgentSession` carries none.

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

## Rejected alternatives

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
