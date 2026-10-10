# The idle hook, the settled id and an unqueued snapshot

Working note for three changes that came out of the first outside host's
feedback on `onSettled`: `agent.onIdle(...)`, an `id` on
`SettledOperation`, and `snapshot()` waiting for idle in place of a slot in
the queue. Normative text is in
`docs/architecture/agent-state.md` (invariants 8, 9 and 10).

## Starting point

The host shows its client a run: `run:start` when work begins, `run:stop`
when it ends. `onSettled` gave it the end of each operation and nothing
gave it the start, so it guessed: when A settled with B queued, it sent
`run:start` for B at the end of the hook. If the user pressed Stop before
B started, B was dropped, never settled, and the run stayed open. The host
closed it by hand in its own `cancel()`, when `agent.cancel()` returned
`false` while its state said a run was active.

The gap between the hook returning and B starting is real. The Agent still
waits for the other callbacks and the tracer flush, and in that time the
task is `settling`: `cancel()` answers `false` and `clear()` still
withdraws B.

## The design conversation

The first request was a start hook, the mirror of `onSettled`. It had been
rejected that morning on the grounds that the host can read what is next
from `transcript.pending[0]`. That reading is what broke: `pending[0]` is
what is next, not what started. But the start already has a signal, the
turn opening under the pending id (`turn:user` for a send, `turn:start`
for a compaction), so a start hook would still have no job.

The second request was better: the host's run means "the agent is busy",
not "one operation is running", so what it lacks is the end of the busy
period. Only the scheduler knows that moment. A host can derive most of it
(a settle with nothing queued) but not a drop that empties the queue: a
drop during the last settle hook must leave the run for the hook to close,
and a drop just after the hook returned must close it at once. Telling
those apart is mirroring the scheduler's task state.

Whether it should be an event or a hook was settled by what each channel
carries. Every turn event changes what a `Transcript` holds, and going
idle changes nothing there. Invariant 9 had defined a hook as the thing
that is awaited; it now says events carry the transcript and hooks carry
lifecycle, with awaiting a property of each hook. `onIdle` is not awaited,
because the Agent is free by the time it fires.

The id was the smaller point. The hook said what settled but not which
queued row it was. Counting fails without a real queue: a send that fails
in setup emits `pending:dropped` and also settles, so a host that removes
the row on the drop credits the settle to the next one.

`onIdle` then exposed an oddity. `snapshot()` was a queued task, so one
taken while idle made the Agent busy and fired `onIdle` with no operation
before it. The host's "clear conversation" action does that, and its idle
handler needed a guard. Firing only after a send or compaction would have
meant the scheduler remembering what ran. The cleaner reading was that a
snapshot is not something the user asked the Agent to do: it only needs
the Agent at rest, and that is now a named state. So `snapshot()` left the
queue and waits for idle. Returning the current state at once was also
considered and dropped, because mid-turn the messages can hold a user
message with no reply.

## What landed

- `AgentScheduler`: takes an optional `onIdle` and calls it in `run()`
  when a task finishes and the queue is empty.
- `Agent`: `onIdle(callback)` returning an unsubscribe; callbacks run
  synchronously, and one that throws is recorded under an `agent.idle`
  span.
- `SettledOperation` gains `id`: the user turn id for a send, the
  compaction turn id for a compaction.
- `snapshot()` resolves at once when the scheduler is idle and otherwise
  on the next `onIdle`. It is no longer a task, so it fires no `onIdle` and
  `clear()` does not cancel it.
- `IdleCallback` exported.
- Docs: invariants 8 to 10, rejected alternatives, terminology, README,
  migration.

## Left out

- A start hook. The host opens its run on `pending:queued` when none is
  open. Opening before the call is wrong for `compact()` with no
  compaction configured, which schedules nothing and so never goes idle.
- An id on the handle. `compact()` returns a bare promise.
- A `busy` getter. The host knows it is busy from its own call and learns
  the end from `onIdle`.

## Verification

Agent tests: `onIdle` fires once when the queue drains and after the last
`onSettled` resolves; fires when `clear()` empties the queue during the
last settle; waits for a send made during the last settle; a send from
inside the callback runs; a throwing callback does not stop the others;
unsubscribe stops it. `snapshot()` on an idle agent fires no `onIdle`; one
requested between two sends includes both; `clear()` does not cancel it. The settle payload tests now assert the id against
the one `pending:queued` carried, for a completed send, a cancelled send,
a setup failure beside a cleared send, and both compaction outcomes. No
live provider was exercised.
