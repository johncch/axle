# Tool loop

**Status**: current · **Last design revision**: 2026-11-05 (0.36.0, AXL-103)

This document is normative for how a step's tool batch is executed: when
the calls start, the order their results answer in, what one call's failure
does to the others, and how the usage they reported is kept when the batch
ends early. Code and tests are built against it; divergence is a defect.
Vocabulary is defined in [terminology.md](../terminology.md). Which
failures reject the handle is in [errors.md](./errors.md); how a rejected
handle interacts with the agent's queue is in
[agent-state.md](./agent-state.md); a tool the provider runs on its own
side is in [provider-tools.md](./provider-tools.md).

## Invariants

1. **A tool batch runs concurrently.** Every call in the batch starts
   before the loop waits on any of them, and no call waits for an earlier
   one. The step's tool phase takes as long as its longest call. There is
   no concurrency cap: the model bounds the batch by how many calls it
   makes, and a tool that must throttle itself (a subagent, a rate-limited
   client) does so in its own `execute`.
2. **Results answer in request order, one per call.** The tool results
   message lists one result per call id in the order the assistant message
   requested them, whatever order the calls finished in. A call whose
   arguments did not parse holds its slot with a synthetic error result and
   never runs. Every provider requires a result for every call id before
   the next request, so the loop waits for the whole batch.
3. **An ordinary failure is a result and touches no sibling.** Arguments
   that fail the schema, a tool that is not found, and an `execute` that
   throws a plain error each become an `isError` result for that call. The
   other calls run to completion and the model sees every result.
4. **The first terminal error ends the batch.** A call that throws
   `AxleToolFatalError`, or that observes the run's abort, is terminal. The
   first terminal error by settle time aborts the batch's other calls
   through their signal, the loop waits for every call to settle, and the
   batch rejects with that first error. A tool that ignores its signal
   delays the rejection until it returns. No tool results message is
   appended; results the other calls already produced are discarded.
5. **A tool's signal is the batch's, not the run's.** `ctx.signal` aborts
   when the run's signal aborts, with the run's reason, and when a sibling
   fails, with the sibling's error as the reason. A tool that rethrows its
   signal's reason was aborted, whatever that reason is: the loop reports
   it as `aborted`, never as a second fatal, because the reason is the
   sibling's `AxleToolFatalError` object itself.
6. **Usage on a thrown error is the batch's total.** Every settled call's
   reported usage is merged onto the thrown error: calls that completed,
   the call that failed, and siblings cut short, each of which attaches
   what it reported before the abort. `executeStepTools` then merges the
   loop's accumulated usage on top, as [errors.md](./errors.md) records for
   a rejected handle.
7. **`execute` and `onToolCall` may run concurrently.** `onToolCall` is
   called once per deferred call with no ordering between calls in a batch,
   and executable calls run beside it. State a consumer shares between
   calls is the consumer's to guard.
8. **Events and spans are per call, correlated by id.** `tool:exec-start`
   fires for every call before any completes; `tool:exec-delta`,
   `tool:exec-complete` and `tool:exec-error` arrive in finish order and
   interleave across calls. A consumer keys on the event's `id`, never on
   "the running tool". Tool spans open in request order, because the span
   starts before the call's first await, and close in finish order. Usage
   breakdown rows from several subagents in one batch interleave in
   wall-clock order; each row still carries its `agent`.
9. **Every action part in a turn that did not complete settles.** On the
   turn event stream an action part ends with exactly one of
   `action:complete`, `action:error` or `action:cancelled`. A call that
   observed the run's abort ends `action:cancelled`, not `action:error`; a
   fatal call ends `action:error`. When a turn ends `cancelled` or `error`,
   every action part still open (a call still streaming, one whose batch
   never started, a provider tool with no result) gets `action:cancelled`
   before `turn:end`. A `complete` turn closes nothing: every call there
   was answered, and an open provider tool is an adapter defect left
   visible rather than relabelled. (2026-11-02, AXL-91)
10. **A deferred call is a call in the batch like any other.** A deferred
    tool has no `execute`; its validated call goes to `onToolCall` and the
    batch waits for the answer as it waits for a running tool, so
    invariants 1 to 9 hold for it unchanged, with two additions. The call
    settles by whichever comes first: the handler's return or throw, the
    tool's `timeout`, or the run's abort. A throw is an `execution` result
    as for `execute`; a handler that returns nothing, or no handler at all,
    is an `unanswered` result; a timeout is a `timeout` result; the abort
    is terminal as in invariant 4. Once anything but the handler settles the call, the
    handler's signal aborts and what its promise later resolves to or
    rejects with is dropped, which is the one place a call does not wait
    for the code answering it: the handler runs outside the loop and may
    be a person. `onToolCall` is never consulted for an executable call.
    (2026-11-05, AXL-103)

## What the model sees

Nothing in the batch's shape changes with concurrency. The assistant
message holds one tool-call part per request; Axle answers it with one
message of role `tool` whose `content` holds one result per call id in
request order. Each adapter reshapes that one message for its API:

| Provider         | Wire shape of the tool results message                               |
| ---------------- | -------------------------------------------------------------------- |
| Anthropic        | one `user` message holding one `tool_result` block per `tool_use_id` |
| OpenAI Responses | one `function_call_output` item per `call_id`                        |
| Chat Completions | one `role: "tool"` message per `tool_call_id`                        |
| Gemini           | `functionResponse` parts                                             |

## Design rationale (2026-10-29)

Before 0.35.0 `executeToolCalls` awaited each call before starting the
next. Models request several tool calls in one message routinely, so three
`write_file` calls or two subagents ran one after another for no reason,
and the only way to get concurrent execution was a parallelized tool,
which asks the model to use a different tool with an `items` array.

The change is confined to the loop because everything per call was already
isolated: each call opens its own tool span, builds its own `ToolContext`,
accumulates its own usage, and reports observer events tagged with the
call. The event builder maps every `tool:exec-*` event through the call id,
and `executeStepTools` already rebuilt the results message by walking the
original call list, so ordering and event delivery needed no change.

What needed deciding was the failure path. A fatal is a tool telling the
caller to stop, so waiting for its slower siblings to finish on their own
would hold the rejection on work the caller no longer wants; the batch
therefore cancels them through the signal every tool already receives.
Cancellation means the batch needs a signal of its own, derived from the
run's, which is why `ctx.signal` is no longer the run signal object. The
abort reason is the failing call's error rather than a synthetic marker so
a sibling's abort says why it was cut short; the cost is the classifier
rule in invariant 5, since a tool that rethrows its signal's reason, as
`fetch` does, would otherwise look like a second fatal and its usage would
be counted twice. The rejection waits for every call to settle so that the
usage on the thrown error is complete and no call outlives the batch
unobserved.

The first terminal error is chosen by settle time, not request order. It
is the error that caused the cancellation; any later terminal error from a
sibling is either the abort it was given or a failure that raced it, and
neither explains why the batch ended.

## Design rationale (2026-11-05): deferred calls through `onToolCall`

`onToolCall` predates `execute`: the first tool loop delegated every call to
the caller and `null` meant "not found". Once tools carried `execute`, the
callback survived as an interception step in front of it that nothing in
the repository used. A deferred tool needs exactly a call the caller
answers, so the callback is retyped for that and the interception is
removed rather than given a second meaning for `null`. The alternative,
ending the step when a deferred call appears and restarting it once the
answer arrives, was prototyped and dropped: it made the turn end early,
pushed a batch record into the session, and required a second turn and
cross-turn settle events, all to express what the loop already expresses
by awaiting a promise.

## Rejected alternatives

- **A serial loop** (2026-10-29): the design before 0.35.0, described
  above. Removed.
- **Deprecating `parallelize()`** (2026-10-29): the ticket's original
  scope, on the view that the model's own parallel calls do the same job.
  Rejected because a parallelized tool is a different unit: one validated
  call, one byte budget across all items, per-item failure reporting, and
  an explicit `maxConcurrency`. A tool batch gives none of those. Both
  stay.
- **A default concurrency cap** (2026-10-29): `parallelize` defaults to 8.
  Rejected because the model already bounds the batch, a cap is new
  surface on `stream()`, `Agent` and the CLI schema, and a tool that needs
  throttling knows its own limit better than the loop does. A cap can be
  added if a live check shows rate limiting.
- **Letting siblings run to completion after a fatal** (2026-10-29): the
  simplest loop, no batch signal. Rejected because a fatal would wait on
  the slowest sibling, and a cancelled run would leave subagents streaming
  until they finished on their own.
- **Choosing the first terminal error by request order** (2026-10-29):
  rejected because the error that settled first is the one that aborted
  the others; a request-order pick could surface a sibling's abort as the
  cause of its own cancellation.
- **Suspending the step at a deferred call** (2026-11-05): return from
  `stream()` with the batch held, resume with a second call. Rejected as
  above; a deferred call that outlives the process is lost with the turn,
  as a running `execute` is.
- **Keeping `onToolCall` as an interception hook for executable tools**
  (2026-11-05): rejected because `null` would mean fall-through for one
  kind of tool and unanswered for the other, and no consumer used it.
- **A `decline()` on the handler's context** (2026-11-05): rejected for
  parity with `execute`, which has no such thing. A refusal with a reason
  is a throw, a refusal after a pending promise is its rejection, and a
  branch that does not match returns nothing.
- **Aborting siblings with a synthetic reason** (2026-10-29): a marker
  object in place of the failing call's error. Rejected because the
  sibling's abort would no longer say why it was cut short; the classifier
  rule in invariant 5 is cheaper than losing the cause.
