# Compaction

**Status**: current (@experimental API) · **Last design revision**: 2026-08-12 (0.30.0)

This document is normative for compaction's contract and lifecycle. Code and
tests are built against it; divergence is a defect. State ownership is
defined in [agent-state.md](./agent-state.md).

## Invariants

1. **Three layers, one job each.** `triggers` say *when to ask*
   (`beforeTurn`, `afterTurn`; omitted = manual-only). `shouldCompact(state,
   {usage, trigger})` says *whether* — consulted at every boundary including
   `manual`; "a manual request always compacts" is compactor policy via
   `ctx.trigger`, never an engine carve-out; omitted = always willing.
   `compact(state, ctx)` does *the work* — it returns the complete new
   `AxleMessage[]`, never declines (`null` is not a return), and throws on
   failure.
2. **A `shouldCompact` decline is the only silent path.** Nothing is
   emitted, nothing ran, no id was allocated. Everything past a `true` is
   visible turn work.
3. **Compaction is ordinary, fallible, streamed turn work** — the lifecycle
   mirrors tool calls. `part:start` delivers `CompactionPart { id, type,
   status: "running" | "complete" | "error", summary?, error?, timing? }`
   into its turn; `compaction:delta` streams `ctx.emit(...)` text onto it;
   exactly one of `compaction:complete` / `compaction:error` settles it.
   `complete` carries the authoritative stamped-summary text, replacing
   accumulated deltas.
4. **Settle ⇔ applied.** A part that settles `complete` means the message
   swap applied, atomically. A `running` part means nothing has been
   committed yet. An `error` part records a failed attempt that changed
   nothing.
5. **Placement: turns can be started or ended by compaction.**
   `beforeTurn` → head of the send's turn (`U A⟨compaction, …⟩`); the
   callback sees the pre-send conversation and the apply re-appends the
   pending user message so it survives verbatim. `afterTurn` → tail of the
   send's turn, before `turn:end`. `manual` → the engine opens a turn,
   streams the part, closes it.
6. **Failures are non-fatal for automatic triggers**, like tool-part
   failures: the errored part is the record, the turn keeps its model
   outcome, and the send continues on the uncompacted conversation — a
   genuine context overflow then surfaces as the turn's model error.
   `manual` failures reject (explicitly requested) and still settle the
   errored part and turn on the tape.
7. **The stamp is the correlation and recursion mechanism.** Compactors mark
   output messages with `metadata.axleCompaction = { id: ctx.id, role:
   "summary" | "appendix" }`. The engine surfaces `role: "summary"` text
   (matching the current id) as the part's summary; compactors recognize
   their own prior output by scanning for the stamp, so consecutive
   compactions never re-quote an earlier summary or appendix. Unstamped
   output is valid — the part settles without a summary (bare divider).
8. **The summary exists twice on purpose**: the stamped message (for the
   model; replaced by the next compaction) and the part summary (for the
   reader; frozen in the tape). The shared id makes them two views of one
   identified event.

## Design rationale (2026-08-12)

Compaction is the single channel through which the Agent's past changes
form; how the *transcript* treats that moment is the consumer's business
(see agent-state.md). What remained to design was the engine contract, and
the pressure that shaped it was the skip: with `afterTurn`, the policy is
consulted after every turn and almost always declines, so any design that
announces before deciding either spams retractions into every fold or lies.
Splitting the decision out (`shouldCompact`) makes the common case free and
the announced case honest — once the policy commits, the compaction is real
work and gets the same treatment as a tool call: visible, streamed,
fallible, recorded.

Streaming (`ctx.emit` → `compaction:delta`) is not cosmetic. A long
summarization is otherwise a dead-silent window on the wire — bad for users
(no liveness, especially the `beforeTurn` window before the user's own turn
renders) and bad for infrastructure (idle-timeout-prone transports like
ALBs drop quiet connections). Real content is the heartbeat.

The failure posture follows from "compaction is infrastructure": its
failure must not destroy the user's completed work, so automatic failures
record and continue — `A⟨…, compaction(error)⟩` then next turn
`A'⟨compaction(ok), …⟩`, or `A'⟨compaction(error)⟩` plus a context-overflow
model error when continuing genuinely no longer fits.

`PromptCompactor` implements the policy pair: `shouldCompact` is
empty → false, manual → true, else `usage.total >= thresholdTokens`;
`compact` streams via `stream()` and returns two stamped messages (summary,
recent-user-messages appendix) so the engine surfaces only the summary on
the part.

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
  fold-ignored) (2026-08-12): brackets the work but is silent *during* it —
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
  jobs. Non-array results are errored compactions, not skips.
