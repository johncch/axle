# Continuations: inline turns at the rest point (AXL-12)

Working note for the change that lets a send carry a program that runs
after its turn and before the queue moves on, with the ability to run
further turns inline. Normative text is in
`docs/architecture/agent-state.md` (invariants 8, 9 and 11).

## Starting point

The ticket was two months old and had been rewritten once. The first
version (2026-08-25) was a queued `agent.run()` that reserved the slot and
received a context with inline sends. The second (2026-10-09), written
after the 0.34.0 settle work, attached the same program to the send it
followed, which removed the `target` handle, the missing pending entry and
the `run` terminology collision at once. The first outside host had
reviewed that draft and left the gaps that shaped today's conversation:
whether the continuation runs on failure, what the handle resolves with,
how `cancel()` interacts with the settle window, and the name.

## The design conversation

The first move was a step back. Stripped of consequences, the design is
one addition: a send can carry a function that runs after its turn ends,
while the Agent still holds the queue, and inside it the host runs more
turns directly. The only question that had to be agreed before any detail
was whether this belongs on the send or whether the queue should let the
host insert at the front. On the send, the judge loop is a `for` with a
counter; at the front of the queue it is a state machine across several
settle firings. The send won.

Whether inline turns need a continuation of their own answered itself
once the primitive was seen as a held slot with a sequential inside API
rather than a callback: judging the correction is the next line of the
loop. That reading also explained why the queued `agent.run()` and the
attached `after` share their inside exactly and differ only on how the
program gets its place.

`onSettled` per turn or per operation was walked through with a concrete
sequence, A then corrections F1 and F2 with B queued throughout. Per turn
gives three save points and one handle; per operation gives one save point
and a crash during the second judge loses a committed, already-streamed
turn. Per turn won, and no per-operation hook was added beside it: the
handle and the continuation's own return already mark the operation's end.
The per-turn firing is the one place where this feature reaches back and
reinterprets 0.34.0, so it is named as the cost.

The handle's result took the longest. "Resolves with what the continuation
returns" subsumed every shape but made the handle's type depend on host
code, which needed two extra overloads and a type parameter, and a
continuation that returned nothing yielded a void handle. "Resolves with
the last turn's result" kept the type only while every inline send shared
the first send's schema. An array of results, the user's instinct, was
right about the facts and wrong about the owner: three turns happened, but
only the continuation knows which one won. So the Agent records the facts,
`after: InlineTurn[]` on the result with each inline turn's own `ok`, and
the meaning stays in the host's judge. The top-level fields remain the
message that was sent and its reply.

The remaining calls were quicker. The continuation runs when the turn
resolved, `ok` or not; a rejected turn has no result to hand over and
skips it, which replaced the draft's "every outcome except cancellation"
and spared the continuation a settled-result wrapper as its argument.
`cancel()` cancels whatever remains and returns `false` only when nothing
does, so a plain send in its settle window keeps the 0.34.0 answer.
Inline sends serialize. The option is `after`, since a function-valued
`then` makes the options object a thenable and observer names promise the
wrong thing. "Continuation" stays as the noun and invariant 1 gave up the
word.

One field was carried for three messages and then dropped: a parent
operation id on an inline turn's settle. Walking through what Sunnyday
does with the id showed that id-keyed hosts ignore an unannounced id by
construction, and every job that would tell inline turns apart already
lives in the continuation. A field with no reader.

## What landed

- `AgentScheduler`: a `continuing` task state; `schedule()` takes `after`,
  run after the settle step for a fulfilled, un-cancelled task with an
  `InlineRunner` whose `run()` executes work then settle, one at a time;
  `cancel()` aborts in `continuing` and in `settling` when a continuation
  remains, and `cancelCurrent()` answers from the task's `remaining`. An
  inline run still in flight when the continuation returns is awaited; one
  started afterwards rejects.
- `Agent`: `send()` takes `after`; `prepareSend` is shared by the queued
  and inline paths; `executeTurn` takes a prepared send, whether the turn
  was announced (an inline turn emits no `pending:dropped`), and a span
  parent so inline turns nest under `agent.continuation`; the Agent keeps a
  fold of pending preview turns for `ctx.pending`.
- Types: `Continuation`, `ContinuationContext`, `InlineSendOptions`,
  `InlineTurn`; `after` on `AgentResult` and `AgentErrorResult`;
  `SendMessageOptions<T>`.
- Docs: terminology (continuation, inline turn, operation, and the session
  keeps "resumable state"), `agent-state.md` invariants 1, 8, 9 and 11 with
  the dated section and rejected alternatives, README, the 0.35.0
  migration entry, and a `checks/` case.

## Left out

- A parent operation id on an inline turn's settle (see above).
- `after` on `compact()`.
- A trace diagnostic for `agent.send()` awaited inside a continuation; the
  deadlock stays documented, as it is for `onSettled`.
- Front-of-queue send (AXL-85) stays a separate, user-side queue feature.

## Verification

Scheduler tests: `after` runs after the settle and before the handle, its
inline runs settle one at a time and the handle takes the returned value;
skipped on a rejected work; a throw rejects the handle and the queue
continues; `cancelCurrent()` during a continuation aborts the signal and
rejects; in the settle window it is `true` only with a continuation
remaining, which then never starts; an inline run in flight at return is
awaited and a later one rejects. Agent tests: the A, F1, F2 sequence with B
queued, including three settles, one handle, the `after` list and no
pending entries; `after: []` without a continuation; a run for `ok: false`;
skipped on a cancelled turn; `cancel()` mid-judge with `stop()` returning
`false`; `ctx.pending` and `ctx.messages`; an unawaited `agent.send()`
queuing at the back; `ctx.send()` after return rejecting; one `onIdle`.
Whole repo: 103 files, 1498 tests, with one pre-existing CLI failure in the
schedule reconcile suite that fails on the base commit too. No live
provider was exercised; the `checks/` case is written and typechecks but
has not been run.
