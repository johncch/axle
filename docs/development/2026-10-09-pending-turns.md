# Pending entries as turns, and seeding a mirror (AXL-82)

Working note for the change that makes a pending entry a `Turn` and lets
the `Transcript` constructor take pending turns. Normative text is in
`docs/architecture/agent-state.md` (invariant 7 and the dated section).

## Starting point

The ticket was the constructor: a host mirroring a live server transcript
in the browser could be handed `turns` but not `pending`, because the
constructor took only `turns` and the doc read that as "pending is never
constructed" when it meant "never persisted". The fix was a second
argument.

Planning it raised the shape question. `PendingEntry` was a tagged union:
a send carried a preview user turn, a compaction carried only an id. The
CLI rendered the list through a `kind` switch rather than its turn
component. The `Turn` type exists so a host draws a transcript with one
component in one loop; the pending list, which a host wants drawn right
under the turns, did not fit.

## The design conversation

The first step was to give every entry a turn (`{ kind, turn }`). The next
question was how to indicate pending on a turn whose statuses were
`streaming | complete | cancelled | error`: add `"pending"`. Then `kind`
was redundant, since a user turn is a send and an agent turn with a
compaction part is a compaction, and the entry collapsed to the turn
itself. The compaction preview needed one part to be self-describing, so
the compaction part's status gained `"pending"` too, the value action parts
already use.

This is not the "queued status in `turns`" the 2026-10-08 design rejected.
That rejection was about the append-only record and saved data; a
`pending` turn lives only in `transcript.pending`, which is never saved.

The seed's discard rule came from a review of the ticket: the fold resolves
an entry only when its turn opens or it is dropped, so a seeded entry whose
turn opened before the client's stream cursor would stay pending forever.
The constructor drops entries whose id is already in `turns`; capturing
`turns`, `pending` and the cursor in one read is the host's rule.

## What landed

- `TurnStatus` and `CompactionPart.status` gain `"pending"`;
  `PendingEntry` is gone and `pending:queued` carries `turn: Turn`.
- `send()` emits `{ ...userTurn, status: "pending" }` and commits `userTurn`
  as before; `compact()` builds an agent turn with one `pending`
  compaction part.
- `Transcript.pending` is `readonly Turn[]`; the constructor takes
  `pending` as a second list and discards ids already in `turns`.
- CLI: the Ink store holds `Turn[]`; the queued-row label reads the turn's
  parts instead of an entry kind. Rendering is unchanged.
- Docs: invariant 7, the dated section and two rejected alternatives,
  terminology (Pending turn; the status lifecycle on Turn), README, the
  migration doc's breaking and additions entries.

## Left out

- Rendering pending rows through the CLI's `TurnView`. The queued row is a
  one-line summary by design; the label now reads the turn, which was the
  point.
- Pending state for subagent child transcripts, as before.

## Verification

Transcript tests: a queued send and compaction are pending as turns with
`status: "pending"`; a seeded list mirrors and resolves on `turn:user` and
`pending:dropped`; a seeded entry already in `turns` is discarded. Agent
tests assert the committed user turn equals the preview with
`status: "complete"`. Compaction tests assert the preview's compaction
part. CLI renderer tests build pending rows from turns. Whole repo: 102
files, 1438 tests.
