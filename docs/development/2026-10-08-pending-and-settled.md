# Pending operations and the settled callback (AXL-75)

Working note for the change that lets a host render queued work and save as
each operation finishes. Normative text is in
`docs/architecture/agent-state.md` (invariants 7 and 8).

## Starting point

The ticket was one line: "Let Transcript handle pending messages." The
problem behind it was the `agent.stop()` / `agent.send()` dance. A send made
during an active turn sat in the scheduler as a closure and emitted nothing
until `turn:user`; `clear()` and a cancelled handle were silent. The CLI
worked around it by never using the Agent's queue: the Ink renderer held
typed-ahead strings in its own list and fed them to `send()` one at a time.
Other consumers showed nothing at all.

What made it hard was that transcripts had always been append-only, and a
queued message is ephemeral.

## The design conversation

Three shapes were on the table: leave it to hosts, put queued turns in
`turns` with a new status, or give `Transcript` a second collection. The
second fails on drops (remove or tombstone), on the meaning of `turn:user`,
and on persistence, so the third won.

Most of the conversation was about persistence. If a client has seen a
pending row and the server snapshots and exits, nothing stored the message.
The options went, in order:

- Carry pending in `AgentSession` and restore it. A queued send is more than
  its message (schema, resolver, signal, handle), so a restored one could
  only be held for the host to re-run, and a host that never did would leave
  it pending forever. Dropped for that reason.
- A `Transcript.snapshot()` that filters pending, to keep the two saved
  halves in step. Redundant once pending was outside `turns`.
- Discard on restore. With a separate collection this costs nothing: the
  constructor has no way to accept pending entries.

Walking a worst case (twenty tool calls in flight, ten messages and a
compaction queued, server shutting down) turned up two facts that shaped the
rest. `snapshot()` queues behind everything, so it cannot be used to save
promptly while work is queued, and `clear()` cancels a queued snapshot. And
the active turn has the same lingering problem pending was designed to
avoid: mid-turn, turns are ahead of messages. A graceful shutdown is
therefore `clear()`, then `stop()` or `cancel()`, then save.

Scope widened once: pending is about queued operations, not sends. A manual
compaction goes through the same queue, so an entry is a placeholder for a
turn that has not opened, keyed by that turn's id, with a `kind`.

## What landed

Core:

- `PendingEntry` and `PendingDropReason`; `pending:queued` and
  `pending:dropped` on `TurnEvent`; `Transcript.pending`, resolved by a turn
  with the entry's id opening or by a drop.
- `send()` materializes the message and its user turn up front and emits
  the queued event before scheduling. The same turn object is later emitted
  as `turn:user`.
- Drops come from two places: the scheduler, through a callback fired when
  a queued task is withdrawn, and turn execution, when a started send ends
  before its user turn.
- `compact()` chooses its id when called; the compaction run takes a tagged
  target so the manual case can carry it.
- `agent.onSettled(...)`, added after the CLI work showed that saving
  through `snapshot()` waited for the whole queue.
- `agent.cancel()`, so a host can cancel the active operation without
  finding its handle.
- `onSettled` callbacks are guarded. A side review pointed out that a
  throwing callback replaced the result of a send that had already
  committed; a throw is now caught and recorded on the trace.
- A cancelled turn's status now follows the abort signal. Found by a test
  whose mock provider rethrew a string reason.

CLI, as the first consumer:

- The chat loop sends each submission straight to the Agent under Ink and
  draws queued rows from `transcript.pending`. Renderers declare whether
  they accept input during a turn; the plain renderer does not.
- Ctrl-C in a chat cancels the active operation and lets the queue
  continue; a second press within a second aborts the session. Runs without
  a chat keep stop-then-cancel.
- The session runtime saves from `onSettled`, with writes chained.
- Cancelled turns are marked `(interrupted)`, and the input line stays
  visible while a turn runs.

Found while testing, and fixed on the same branch: a provider profile's
`apiKeyEnv` was resolved against the process environment only, so a key in
a credentials file was never found; and a `chatcompletions` profile whose
named key was missing sent the request anyway. Filed separately as AXL-79:
the generic, unnamed chat-completions provider should not exist.

## Left out

- Recording `stop()` in the transcript. A stopped turn still ends
  `complete`.
- Pending state for subagent child transcripts.
- Durability for queued operations across a restart. A host that wants it
  keeps its own inbox.

## Verification

Unit tests cover the fold (queue, commit, drop, order, restore), every drop
path for sends and compactions, the interject sequence, `onSettled` firing
once per operation before its handle settles and not at all for drops, and
`cancel()` on the active operation only. CLI tests cover the queue draining
before `/quit`, one and two Ctrl-C, a save landing while later messages are
still queued, and the queued and interrupted rows. Whole repo: 100 files,
1400 tests.

One chat session was run by hand against OpenRouter: an interrupt, a
following message, an abort, and a resume all behaved as designed. A full
turn completing after an interrupt was not observed in that session, and no
provider other than OpenRouter was exercised.
