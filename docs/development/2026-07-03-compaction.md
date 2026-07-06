# Context Compaction

Status: **experimental** (0.26.0). Every compaction surface is marked
`@experimental` and may change in any release. The design intent is to ship
the smallest mechanism that lets a real harness (the coding-agent project)
discover the right policy — not to finalize an API.

Axle provides compaction as a mechanism, not a policy. The engine owns where
compaction may safely happen, how state changes, and structural validity of
the result. Deciding _when_ to compact and _what_ the compacted conversation
looks like belongs entirely to a caller-supplied callback. Axle ships no
default strategy; one may be promoted into the package after dogfooding,
following the subagent playbook.

## Principles

1. **Compaction is destructive at the message layer, by design.** The active
   conversation is replaced. Records are receipts for inspection ("compacted
   twice, here and here"), not backups — reconstructing the pre-compaction
   conversation is a non-goal. The raw appends survive in the archive and
   the renderable record survives in the turns; neither is consulted to
   build requests.
2. **The active conversation is primary, not a projection.** `messages` is
   the thing requests are built from and reads require no computation.
3. **Messages → events → turns, with one fold.** Turn state is only ever
   written by folding events through the agent's single accumulator. The
   engine and any consumer folding the same event stream agree by
   construction.

## State (History)

`History` is a state holder — all fields private, reads return copies,
writes go through use-case methods. The Agent owns all behavior.

- `messages` — the active, model-facing conversation.
- `archive` — every message ever appended, in order. `append()` dual-writes
  to both stores, so the archive is always the complete chronological record
  of the _raw_ conversation. Compaction never touches it; summaries do not
  appear in it. Inspection only — never part of a request.
- `compactions` — receipts: `{ id, at }`.
- `turns` — the renderable session record: `Turn = MessageTurn |
CompactionTurn`. Forever-accumulating; consumers decide how to render or
  prune.
- `sessionAnnotations` — session-level render annotations.

Write surface: `append(messages)` (dual-write), `replaceTurns(turns,
annotations)` (the fold's mirror), `compact(messages, record)` (swap the
active conversation, keep the receipt).

## The callback

```ts
type CompactionCallback = (
  state: { messages: AxleMessage[] },
  context: { usage: ContextUsage; signal?: AbortSignal },
) => MaybePromise<AxleMessage[] | null>;

agent.onCompaction(cb); // one per agent; registering again replaces
await agent.compact(); // resolves the receipt, or null
```

The callback is both trigger policy and strategy: inspect `usage`, return
`null` for "not now" (cheap — the estimate is local), or return the complete
new active conversation. Compaction is fully optional: with no callback
registered, `compact()` is a silent no-op resolving `null` — no events, no
turns entry.

`compact()` is enqueued on the agent's work queue behind in-flight sends, so
it never races a turn. Callback errors propagate to the caller (a manual
compact was explicitly requested) after marking the turns entry `"error"`.

The engine validates the returned conversation structurally
(`validateCompactedMessages`: every tool result answers an earlier call,
every call is answered) so a strategy bug fails loudly at `compact()` rather
than as a cryptic provider 400 mid-send. This validator is a diagnostic at a
trust boundary, not an invariant History enforces — History trusts its
writers, as it always has. If dogfooding shows strategies keep producing
invalid structure, the likely fix is constraining the _contract_ (engine
builds the conversation from a constrained return shape), not more
validation.

## Presentation

Compaction is a peer entry in the renderable turns, not an annotation:

```ts
interface CompactionTurn {
  kind: "compaction";
  id: string; // shared with the record
  status: "running" | "complete" | "skipped" | "error"; // async — "running" covers the stall
  record?: CompactionRecord;
  timing?: TimingInfo;
}
```

Two events, folded by the accumulator like any other: `compaction:start`
(appends a running entry) and `compaction:end` (settles it). The engine does
not touch turns directly — `Agent.emitEvent` is the single write path:
apply the event to the agent-lifetime accumulator, mirror the result into
History, notify subscribers. `MessageTurn`s are never rewritten or cut by
compaction; whether older turns still render (Claude-style inline marker)
or disappear (Claude-Code-style wipe) is a consumer display decision over
preserved data.

## Session persistence

`AgentSession` stays at version 1 with additive fields: `messages` keeps its
pre-compaction meaning (the conversation to continue from); optional
`archive` and `compactions` carry the rest; `turns` may contain
`CompactionTurn` entries. Resume is construct-only: `new Agent(config,
session)`. There is no mid-life `restore()` — it had no consumer and could
race an in-flight send.

`snapshot()` is async and enqueued on the same work queue as sends and
compactions, so it always captures at rest: a legitimate snapshot never
contains a `streaming` or `running` turn, and restore needs no
interrupted-state normalization. Live mid-stream state belongs to the event
stream, not to snapshots.

## Rejected shapes (decision history)

- **Full-log-primary with a derived live view**: inverts primacy — the thing
  consumers operate on becomes a computed projection. Reading the real state
  should not require derivation.
- **Summary or archived content inside the record**: metadata holding data;
  splits the conversation across storage locations.
- **Marker objects inside the message array**: widens the element type every
  provider request builder consumes.
- **Summaries appended into the archive**: made the archive a mixed record
  requiring interpretation; the archive is now raw appends only.
- **Count/index-based records tying archive to records**: existed only to
  support reconstruction, which is a non-goal. Deleted along with all
  cross-store consistency validation.
- **`reason`/`iteration`/`metadata`/`usage` on records and context**:
  speculative fields with no producer or consumer today. Re-add with the
  feature that needs them.
- **Direct turns writes from `compact()`** (bypassing the accumulator):
  split-brain — engine-materialized and consumer-folded turns produced by
  different code. The single-fold `emitEvent` replaced it.

## The mid-tool-loop overflow case

Resolved without threading compaction into `stream()`: the loop primitives
take a `maxContextTokens` budget instead. At each request boundary the
previous model call's reported usage (effective input + output) is checked;
when crossed, the loop returns `ok: true` with `stopped: "token-limit"` and
everything accumulated so far. The conversation is well-formed at that
boundary (tool calls answered), so the caller compacts and continues —
mechanism in the loop, policy outside, same division as everywhere else.
Budget exhaustion is a stop reason, not an error (`maxIterations` was
migrated to the same `stopped` shape); non-positive limits throw at the call
boundary as configuration errors.

## Deferred until dogfooding demands it

- Trigger metadata (`reason`, `iteration`) on compaction records — returns
  if a producer ever needs it.
- Automatic thresholds on Agent; the callback owns triggering.
- A default strategy; constrained return shapes (`{ summaryText, keepLast }`).
- Prompt-cache breakpoints, cost accounting on records.
- Session format rework: the session persists four parallel arrays with
  implicit cross-invariants (archive completeness, compaction/turn id
  correspondence) while still at version 1. Known symptom: restoring a
  session without an `archive` field leaves the archive missing the
  pre-restore conversation. Revisit as a version-2 design, not patches.
- Annotations on compaction turns: the accumulator's `updateTurn` skips
  compaction entries, so annotation events targeting a compaction turn's id
  are silently dropped (`handled: true`, state unchanged). Fix when a
  consumer actually wants to annotate a compaction marker.

## Testing

Three layers, two of which need no LLM:

1. **Mechanism** (vitest, `tests/core/history-compaction.test.ts`): History
   store semantics, validator cases, `Agent.compact` lifecycle
   (complete/skip/no-op/error), request built from the active conversation,
   queue serialization against in-flight sends, engine/consumer fold
   agreement, snapshot round-trips including compaction turns.
2. **Strategy quality** (`checks/compaction`, future): stuff History
   directly from dataset conversations — no generation replay — fire the
   callback as the budget crosses, generate only for QA answers plus an LLM
   judge. Score against a truncation-only floor and a full-context ceiling
   (LongMemEval-S first). The harness consumes `AgentSession` JSON so
   recorded real sessions become drop-in fixtures.
3. **Tool-heavy realism** (synthetic, future): sessions with fat fake tool
   outputs and needle facts planted early; ask for the needles after
   compaction. Covers the coding-agent overflow case chat benchmarks cannot.

## Addendum (2026-07-06): CompactionTurn union replaced by a part

The first Sunnyday migration falsified the `Turn = MessageTurn |
CompactionTurn` union. The diff was almost entirely `isCompactionTurn`
narrowing at every turn access site — dead guards in a host that never
compacts. The union taxed structural access (`turn.owner`, `turn.parts`,
`turn.usage`) on every consumer, violating "inert when unconfigured" at the
type level even though the runtime was inert.

The fix: compaction is an ordinary agent turn containing a single
`{ type: "compaction", record? }` part. Parts are the API's sanctioned growth
axis — consumers access them selectively (`filter(p => p.type === "text")`),
so a new member flows through untouched code. `Turn` reverted to a single
interface; `MessageTurn`, `CompactionTurn`, and `isCompactionTurn` were
removed before ever publishing. The turn's ordinary `status` carries the
async lifecycle (`streaming` → `complete`/`error`); a skipped compaction
still removes the whole turn.

The "peer to a turn" instinct was right about rendering position and wrong
about type obligation: in-band ordering is preserved by being a turn, without
creating a second turn shape.
