# Deferred tools as long tool calls (AXL-103)

Working note for the landed design of deferred tools. It supersedes the
deferred-tool half of
[2026-11-04-remote-agent-and-deferred-tools.md](./2026-11-04-remote-agent-and-deferred-tools.md),
whose prototype proved the shape could work end to end and whose review the
next day replaced most of its Agent-side mechanics. The remote-agent half of
that note stands and is AXL-44.

## The reframing

The prototype ended the turn when the model called a deferred tool, kept the
open batch in `AgentSession`, refused `send()` while waiting, and started a
second turn on `resume(answers)`. Reviewing it, one sentence replaced all of
that: a deferred call is a tool call that got long. From the loop's side an
`ask-user` the person answers in ten minutes and an `ssh` that returns in ten
minutes are the same event. Once that is the model, the lifecycle needs
nothing new:

- The turn stays open. `send()` queues behind it under the scheduler's
  existing rule, `cancel()` cancels it, `stop()` waits for the batch
  boundary, `onSettled` fires once.
- Nothing is persisted. A running `execute` is not persisted either; a
  process that dies loses the turn, and the host's store ends at the last
  settled turn with valid history.
- `stream()` already had the seam. `onToolCall` dated from the first tool
  loop, when every call was delegated to the caller; it survived as an
  interception step in front of `execute` that nothing used. A deferred tool
  is exactly a call the caller answers, so the callback was retyped for that
  and the interception removed.

Everything the prototype added below the Agent for suspension went:
`stopped: "deferred"`, the held batch, `settleDeferred`, `DeferredBatch`,
`AgentSession.deferred`, `resume()`, `agent.deferred`, `onDeferred`, the
third arm on `send().final`, `deferred:settled`, `operationId` on
`turn:start`, the `resume` settle kind, `AgentHandle.refused`,
`Transcript.waiting`, `DEFERRED_WAITING`.

## Decisions, in the order they were made

- **No result arm.** `send().final` resolves with the model's reply, as
  before; while a call waits, `final` is pending. The waiting state is
  reachable through the handler, the `DeferredAction` part and
  `action:waiting`, each the right channel for its consumer.
- **A timeout belongs on the tool.** A deferred tool cannot time itself
  out inside an `execute`, so `timeout` is a field on the definition and the
  loop produces a `timeout` error result. No agent-wide default. The timer
  lives exactly as long as the thing it guards, which is what made it
  acceptable once persistence was dropped.
- **Cancel reaches the handler through the batch signal.** `ctx.signal`
  aborts on cancel as it does for an executable tool. The one divergence
  from `execute`: the loop settles a waiting call at once on abort instead
  of waiting for the handler to return, because the handler may be a
  person. Recorded as tool-loop invariant 10.
- **Stop happens after the tools, deferred included.** The batch boundary
  is the only place history is valid and the external side is not
  mid-work. A host that cannot wait uses `cancel()` or answers with a
  throw first.
- **No `resume()`.** The callback is the one way to answer. A UI answers
  by returning a pending promise and resolving it from a click; it holds
  the `reject` for dismiss. A hop answers what it has and returns nothing
  for the rest.
- **One handler per Agent, a dispatcher with a switch.** Per-tool
  registration was weighed and rejected: it needs a claim rule as soon as
  two parties want one name or one party wants "everything else", it does
  not fit `stream()`, and it spreads the policy of who answers across
  registrations. The handler is a slot, not a listener: its return is the
  call's one result, so a second registration replaces the first, the way
  `setCompaction` does, rather than fanning out or throwing.
- **Parity with `execute`.** The handler gets the same `ToolContext` and
  the same contract: return the result, or throw to give the model an error
  with a reason. A `decline()` on the context was built and removed; a
  refusal with a reason is a throw, a refusal after a pending promise is
  its rejection. The one difference is that a dispatcher may have no
  matching branch, so returning nothing is allowed and is an `unanswered`
  error result.
- **Tool results stay strings.** An `output` schema on the definition was
  built and removed: executable tools have no typed output, so neither do
  deferred ones. Typing tool output, if it ever happens, is a question for
  every tool.
- **Names.** `DeferredTool` was kept after `ConsumerTool`, `DeclaredTool`,
  `ExternalTool`, `AsyncTool` and others were weighed. It says the answer is
  deferred to someone else, which is the contract, and it shares its sense
  with the deferred file references Axle already has. `DeclaredTool` lost
  because every tool is declared to the model and Gemini calls them all
  function declarations. The factory and guard were dropped and the tool is
  written as an object literal like `ExecutableTool`; `satisfies
DeferredTool` keeps the schema type for the guards.
- **`callId` on the part.** Writing the React mock showed the part had no
  way to find its handler's promise. The tool call id is on
  `DeferredAction.detail.callId`, set when the part is created. It is also
  what lets a remote consumer rebuild the `DeferredCall` from events.
- **Two guards.** `isCall(tool, call)` for the handler and
  `isActionOf(tool, part)` for the renderer, both keyed on the name because
  the loop validated the input against that schema already.

## What landed, by commit

1. `DeferredTool` and `AnyTool` in `tools/types.ts`; the registry's deferred
   bucket.
2. `onToolCall(call, ctx)` answering deferred calls only; `tools:
AnyTool[]` on `stream()`; `tool:waiting`; `timeout`; the tests that
   used the old callback as a fake executor converted to deferred fixtures;
   tool-loop invariants 7 and 10; the 0.36.0 migration entry.
3. `DeferredAction` with `callId`; `action:waiting`; builder and
   `Transcript` handling inside the open turn.
4. `agent.onToolCall`; the Agent offers deferred tools; `isCall` and
   `isActionOf`; agent-state invariant 12 and its rationale; ten
   Agent-level tests covering answer, mixed batches, no handler, throw,
   replacement, cancel, stop, timeout, the guards and `context()`.

## What this means for AXL-44

The remote half of the earlier note keeps its shape and loses `resume`.
Two semantics follow from the Agent design and should be stated when the
remote is built:

- A `RemoteAgent` invokes its consumer's `onToolCall` when it sees
  `action:waiting` on a `DeferredAction`, building the call from the part's
  `callId`, `name` and the event's `input`. The handler's return travels as
  an answer command keyed by the call id; `serveAgent` is the origin
  Agent's handler and resolves the promise it holds for that id.
- Returning nothing means something different on a remote. Locally it is
  `unanswered`, because nobody else can answer. On a remote it is "not me":
  no command is sent and the call stays waiting for another consumer, a
  second tab or a hop further down. The origin's `timeout` is the only
  thing that ends a call nobody answers. Two consumers both see the waiting
  part; the first answer settles it, the other's `ctx.signal` aborts, and
  its late answer reaches a settled call and is dropped.

A host that owns its event stream does not need AXL-44 to use deferred
tools: a map of open calls on the server, one POST that resolves or rejects
by `callId`, and a view that renders the waiting part is the whole thing.
