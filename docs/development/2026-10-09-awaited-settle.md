# Awaited settle and the operation outcome (AXL-81)

Working note for the change that lets a host hold the Agent's queue from
`onSettled` and read the operation's result there. Normative text is in
`docs/architecture/agent-state.md` (invariants 8 and 9).

## Starting point

`onSettled` landed the day before (AXL-75) as a synchronous save point. The
first host outside the CLI to adopt it reported the gap underneath three of
its issues: it snapshots a sandbox and saves between turns, and the
scheduler started the next queued operation the moment the callback
returned, so the next turn's tool calls overlapped the snapshot. The CLI
had the same gap and lived with it by chaining saves on its own promise.
The host also emits a `run:stop` that needs the operation's result, which
only the handle carried; whether `run:stop` could land before the next
turn's `turn:user` came down to microtask counting.

## The design conversation

The first question was whether this pointed at a broader lifecycle hook set
the library had never designed. The answer that held: there are two
channels out of the Agent with different jobs. Turn events observe and can
never hold the engine; a hook holds. An operation has two rest points,
before start and after settle, and they are the same instant, so one
awaited hook at that instant covers both and no `onStarting` is needed.
The outcome belongs on the hook so a host does not need the handle at all.

The first implementation awaited the callbacks inside the operation's work
closure. That needed an Agent-level `settling` flag beside the scheduler's
`settled` flag for `cancel()` to answer correctly — two booleans in two
objects implying one lifecycle. The question "shouldn't settling be part
of the scheduler?" moved the phase: a task is `queued → running →
settling → settled`, the scheduler awaits the settle step between the work
finishing and the handle resolving, and hands it the work's outcome as a
`PromiseSettledResult`.

That left a `commit` record the operation marked at `turn:user` so the
settle step could keep the rule "a dropped operation does not fire". The
record was the last flag, and the rule it served was the wrong rule once
the hook carries the outcome: a lifecycle channel that goes silent when
setup fails is a worse channel. The hook now fires for every operation that
ran, which is the scheduler's own knowledge.

Along the way AXL-12 (a queued `agent.run()` for judges) was rewritten as a
per-operation continuation that extends this same settling phase with
inline turns, scheduled for 0.35.0. It does not replace the global hook:
one steers, the other does bookkeeping.

## What landed

- `AgentScheduler`: `ScheduledTask.state` replaces the `settled` boolean;
  `schedule()` takes a `settle(result)` option awaited in the `settling`
  state before the handle resolves or rejects; `cancel()` is a no-op once
  settling and `cancelCurrent()` answers `false` unless running.
- `Agent`: `onSettled` takes a `SettledCallback` `(session, operation) =>
void | Promise<void>`; `send()` and `compact()` pass one unconditional
  `settle` line each; the callbacks run together under an `agent.settle`
  span, since the operation's own span has ended by then.
- `SettledOperation` and `SettledCallback` exported.
- Docs: invariants 8 and 9, the dated section and rejected alternatives,
  terminology, README, migration.

## Left out

- The CLI still chains its saves on `settledWrites` rather than returning
  the write promise. It works unchanged; switching is a small CLI cleanup.
- A trace diagnostic for a nested `send()` awaited from inside a hook. The
  deadlock stays documented, as it is for `compact()` and `snapshot()`.
- `onStarting`, a front-of-queue send (AXL-85), continuations (AXL-12).

## Verification

Scheduler tests: settle runs with the fulfilled or rejected result after
the work and before the handle or the next task; `cancelCurrent()` is
`false` and a handle cancel is a no-op while settling. Agent tests: an
async callback holds the handle and the next send; callbacks run together
and a rejection is logged like a throw; `cancel()` and `stop()` return
`false` in the window; the operation payload for a completed send, a
cancelled send, a send that failed in setup beside one cleared from the
queue, a completed compaction and one run with an aborted signal. Whole
repo: 102 files, 1436 tests. No live provider was exercised.
