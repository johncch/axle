# A tool batch runs concurrently

Working note for AXL-97. The ticket asked for two things: run a step's
tool calls concurrently, and deprecate `parallelize()` once they do. The
first landed; the second was dropped.

## Where the serial loop was

One place. `executeToolCalls` in `providers/helpers.ts` awaited
`executeOneToolCall` inside a `for`. Everything per call was already
isolated: its own tool span, its own `ToolContext` and usage accumulator,
observer events tagged with the call. The event builder keys every
`tool:exec-*` event by call id, and `executeStepTools` already rebuilt the
results message by walking the original call list and looking each result
up by id. So the loop became `Promise.allSettled` over the calls and
nothing downstream moved.

## What needed deciding

- **No concurrency cap.** The model bounds the batch; a tool that must
  throttle itself does so in `execute`.
- **A fatal or abort cancels the siblings.** The batch owns an
  `AbortController` that follows the run signal; the first terminal error
  aborts it with that error as the reason. `ctx.signal` is therefore the
  batch's signal, not the run's object, which one test asserted by
  identity and now asserts by propagation.
- **First terminal error by settle time.** Proposed as request order
  first, changed when the scenarios were walked: the error that settled
  first is the one that caused the cancellation.
- **The rejection waits for every call to settle** so the thrown error's
  usage is the batch's total. A tool that ignores its signal delays the
  rejection until it returns.
- **`onToolCall` may run concurrently.** Documented; the only in-repo
  caller is the `stream()` path.

## The bug the tests found

A sibling that rethrows its signal's reason, as `fetch` does, was thrown
the failing call's `AxleToolFatalError` object as that reason, so
`normalizeTerminalToolError` saw an `instanceof AxleToolFatalError` and
reported a second fatal with the first one's usage folded in. The fix is
one rule ahead of the type checks: a thrown error that is the aborted
signal's reason is an abort. The alternative, a synthetic abort reason,
would have hidden why the sibling was cut short.

## `parallelize()` stays

The ticket's premise was that the model's parallel calls make the
parallelized tool redundant. They do not: a parallelized tool is one
validated call with one byte budget across its items, per-item failure
reporting, and an explicit `maxConcurrency`. A tool batch has none of
those. Both are kept; the terminology entry already draws the line.

## What a consumer sees in 0.35.0

A step's tool phase takes as long as its longest call instead of the sum.
`tool:exec-start` fires for every call up front and completions interleave.
A fatal in one call now cancels calls that have already started rather
than preventing calls that had not. Usage breakdown rows from several
subagents in one batch interleave in wall-clock order. What the model sees
is unchanged.

Decisions and rejected alternatives are recorded in
`docs/architecture/tool-loop.md`.
