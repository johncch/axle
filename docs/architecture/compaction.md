# Compaction

**Status**: current (@experimental API) · **Last design revision**: 2026-08-12 (0.30.0)

This document is normative for compaction's contract and lifecycle. Code and
tests are built against it; divergence is a defect. State ownership is
defined in [agent-state.md](./agent-state.md).

## Invariants

1. **Three layers, one job each.** `triggers` say _when to ask_
   (`beforeTurn`, `afterTurn`; omitted = manual-only). `shouldCompact(state,
{usage, trigger})` synchronously says _whether_ — consulted at every boundary including
   `manual`; "a manual request always compacts" is compactor policy via
   `ctx.trigger`, never an engine carve-out; omitted = always willing.
   `compact(state, ctx)` does _the work_ — it returns `{ messages, summary? }`
   (the complete new conversation plus an optional reader-facing summary),
   never declines (`null` is not a return), and throws on failure.
2. **A `shouldCompact` decline is the only silent path.** Nothing is
   emitted, nothing ran, no id was allocated. Everything past a `true` is
   visible turn work. A thrown policy error propagates as a client
   implementation error. If the send's turn is already open, the engine
   settles it before propagating the error.
3. **Compaction is ordinary, fallible, streamed turn work** — the lifecycle
   mirrors tool calls. `part:start` delivers `CompactionPart { id, type,
status: "running" | "complete" | "error", summary?, progress?, error?, timing? }`
   into its turn; `compaction:update` applies `ctx.emit({ summary?, progress? })`
   as replacement transient state;
   exactly one of `compaction:complete` / `compaction:error` settles it.
   `complete` sets progress to `1` and carries the compactor's returned
   summary, replacing any transient summary.
4. **Settle ⇔ applied.** A part that settles `complete` means the message
   swap applied, atomically. A `running` part means nothing has been
   committed yet. An `error` part records a failed attempt that changed
   nothing. The engine finishes every conversation-state update — including
   the beforeTurn re-append of the committed user message — before emitting
   the settle event, so no event callback ever observes a half-updated
   conversation.
5. **Placement: turns can be started or ended by compaction.**
   `beforeTurn` → head of the send's turn (`U A⟨compaction, …⟩`); the
   callback sees the pre-send conversation and the engine re-appends the
   committed user message once the swap applies, so it survives verbatim.
   Cancellation during this work does not unwind the `turn:user` event or
   remove that message from the active conversation; the agent turn settles
   cancelled.
   `afterTurn` → tail of the send's turn, before `turn:end`; memory records
   the conversation as the turn committed it, before the rewrite. `manual` →
   the engine opens a turn, streams the part, closes it.
6. **Failures are non-fatal for automatic triggers**, like tool-part
   failures: the errored part is the record, the turn keeps its model
   outcome, and the send continues on the uncompacted conversation — a
   genuine context overflow then surfaces as the turn's model error.
   `manual` failures reject (explicitly requested) and still settle the
   errored part and turn on the tape.
7. **The stamp is the compactor's recursion and correlation convention.**
   Compactors mark output messages with `metadata.axleCompaction = { id:
ctx.id, role: "summary" | "appendix" }` so they recognize their own prior
   output on later runs — consecutive compactions never re-quote an earlier
   summary or appendix — and so a message correlates to the part that
   produced it. The engine does not read stamps; stamping is optional.
8. **The reader's summary and the model's summary are separate channels on
   purpose.** `compact` returns `summary` for the part (for the reader;
   frozen in the tape) independently of the messages it returns (for the
   model; replaced by the next compaction). Carrying the same text in both
   is the common case, but it is the compactor's presentation choice —
   "Reduced the context by 50%" is as valid a part summary as the summary
   text itself. Omitted, the latest transient summary remains; without one,
   the part settles as a bare divider.

## Design rationale (2026-08-12)

Compaction is the single channel through which the Agent's past changes
form; how the _transcript_ treats that moment is the consumer's business
(see agent-state.md). What remained to design was the engine contract, and
the pressure that shaped it was the skip: with `afterTurn`, the policy is
consulted after every turn and almost always declines, so any design that
announces before deciding either spams retractions into every fold or lies.
Splitting the decision out (`shouldCompact`) makes the common case free and
the announced case honest — once the policy commits, the compaction is real
work and gets the same treatment as a tool call: visible, streamed,
fallible, recorded.

Streaming (`ctx.emit` → `compaction:update`) is not cosmetic. A long
summarization is otherwise a dead-silent window on the wire — bad for users
(no liveness, especially the `beforeTurn` window before the user's own turn
renders) and bad for infrastructure (idle-timeout-prone transports like
ALBs drop quiet connections). Updates carry complete transient state rather
than fragments. `PromptCompactor` emits estimated progress without mirroring
its generated summary tokens; custom compactors may also publish an explicit
reader-facing summary or status.

The failure posture follows from "compaction is infrastructure": its
failure must not destroy the user's completed work, so automatic failures
record and continue — `A⟨…, compaction(error)⟩` then next turn
`A'⟨compaction(ok), …⟩`, or `A'⟨compaction(error)⟩` plus a context-overflow
model error when continuing genuinely no longer fits.

`PromptCompactor` implements the policy pair: `shouldCompact` is
empty → false, manual → true, else `usage.total >= thresholdTokens`;
`compact` streams via `stream()`, reports estimated progress, and returns two
stamped messages (summary, recent-user-messages appendix) plus the summary
text as the part's reader-facing final summary.

## Rejected alternatives

- **Turn policy in the compaction transform** — `{messages, turns}` return,
  suffix constraint, `retainedFrom` boundary event, `keepTurns` option
  (2026-08-11): dissolved entirely when turns left the Agent; transcript
  retention is host storage policy, zero engine surface.
- **Eviction API / engine-invariant turn eviction** (2026-08-10): compaction
  is the channel; the Agent makes no coherence promise between transcript
  and memory, and once it holds no transcript there is nothing to evict.
- **Session turnover** (compaction rotates a session, old turns evicted as a
  closed chapter) (2026-08-11): an eviction API with lifecycle ceremony;
  chapters survive as a host storage pattern keyed off compaction parts.
- **Dedicated state-bearing lifecycle events** (`compaction:start`/`end`
  creating and settling their own turn, with skip-removal in every fold)
  (2026-08-12): the skip-erasure rule existed only because the compaction
  announced itself before knowing its outcome.
- **Advisory liveness events** (`compaction:checking`/`compaction:outcome`,
  fold-ignored) (2026-08-12): brackets the work but is silent _during_ it —
  a spinner trigger, not liveness — and mints a second ontology of
  events-that-aren't-state that every consumer must learn.
- **Announce-then-retract** and **emit-the-part-early without a decision
  split** (2026-08-12): the former reintroduces skip-erasure per turn; the
  latter announces skips and breaks settle ⇔ applied.
- **A `CompactionStrategy` interface instead of config fields** (2026-08-12):
  isomorphic capability with heavier contract — breaking evolution,
  `this`-binding hazards, harder wrapping — and it forbids deliberate
  mix-and-match (e.g. reusing `PromptCompactor.shouldCompact` with a custom
  `compact`). Flip conditions recorded: a third compactor concern, engine
  need for compactor identity, or multi-compactor chains.
- **`null` as a decline from `compact`** (2026-08-12): the decision belongs
  to `shouldCompact`; a work function that can silently refuse blurs both
  jobs. Malformed results are errored compactions, not skips.
- **Engine-extracted part summary (stamp-scan)** (2026-08-12): the engine
  copied the text of `role: "summary"` messages stamped with the current id
  onto the part, guaranteeing the reader saw exactly the model-facing
  summary. Replaced by the explicit `summary` return: the scan smuggled
  presentation data through message metadata instead of the channel designed
  for it, and the byte-identity guarantee forbade a legitimate compactor
  choice — reader-facing text that differs from the model-facing messages
  (e.g. "Reduced the context by 50%").
