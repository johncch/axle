# A remote agent over a protocol, and deferred tools as its first new operation (AXL-44, AXL-103)

Design note, written before any code. AXL-103 asked for tools the caller
executes instead of the Agent. Answering one from a browser needs a return
direction that AXL-44's transport stops short of. The outcome is one shape
for both. Normative text lands in `docs/architecture/agent-state.md`,
`docs/architecture/tool-loop.md` and a new architecture doc for the remote
agent when the code does; the terms at the end go into
`docs/terminology.md` first.

## Principles

The decisions below were each tested against these. A later change to
either feature should be too.

1. **The remote reads like the local.** `RemoteAgent` is `Agent` minus
   configuration. Consumer code written against one runs against the
   other, and the hook has one body. When a remote behaviour has no
   local counterpart, either the local Agent gains it or the remote
   does not get it.
2. **The interface is the contract. The protocol is its wire form. The
   transport is replaceable.** Anything that implements the operation
   interface can be served; anything that carries frames one way and
   commands the other is a transport. Axle owns the first two and ships
   one of the third.
3. **Operations go in, events come out, and both are unions the host
   extends the same way.** A new operation is a new command member and
   nothing in any host's routing. Results are read from events, not from
   command responses, so every subscriber sees them, not only the one
   that asked.
4. **Consumer code never names an event, a part id, a turn id or a
   sequence number.** Those live inside the fold, the handle and the
   transport. Host code that switches on an event type, or compares a
   tool name in order to render, is the sign that a boundary is in the
   wrong place.
5. **Sinks fold; they do not talk back.** A fold has no return channel
   and does not grow one. Anything that must answer the Agent lives on
   the operation interface.
6. **The remote re-derives from events only what the Agent itself
   holds.** Waiting calls and the in-flight operation are agent state;
   turns are not. One agent, many sinks.
7. **Who answers a deferred call is the consumer's choice.** The tool
   definition is model-facing and carries no mark for it. Every call is
   a part and every call fires the callback; rendering and handling are
   both always available, and a UI is a handler whose body renders.
8. **Transport facts and conversation facts are separate states.**
   `connecting`, `ended` and `error` come from the carrier; `idle`,
   `busy` and `waiting` come from events. The host derives neither from
   turns.
9. **Chainable by construction.** A hop is a consumer facing upstream
   and a server facing downstream. A feature that cannot pass through a
   hop unchanged, or be answered at the hop that has what it needs, is
   designed at the wrong layer.
10. **Nothing new below the Agent.** `stream()` and `generate()` stay
    primitives: a stop reason, data on the result and a helper, never a
    verb.

## The shape

The local case today:

```ts
const agent = new Agent(config);
agent.on((e) => transcript.apply(e));
const handle = agent.send("message");
```

The remote case reads the same with `RemoteAgent` in place of `Agent`.
A React hook wraps either. Everything below follows from holding that.

**The operation interface**, implemented by `Agent` and `RemoteAgent`,
taken by `serveAgent` and by the hook. Names are provisional until the
terminology doc has them.

```ts
interface AgentOperations {
  on(listener: (event: TurnEvent) => void): () => void;
  send(message: string, options?): OperationHandle;
  resume(answers: DeferredAnswer[]): OperationHandle;
  compact(): OperationHandle;
  cancel(): Promise<boolean>;
  stop(): Promise<boolean>;
  readonly deferred: readonly DeferredCall[];          // waiting and unclaimed
  onDeferred(name: string, handler: DeferredHandler): () => void;
  onDeferred<T extends DeferredTool>(tool: T, handler: TypedHandler<T>): () => void;
}

interface OperationHandle { id: string; accepted: Promise<void>; final: Promise<AgentResult> }
```

Nothing that configures an Agent is on it. Tools, MCP, skills, provider
and model live where the Agent lives.

**The protocol** is the contract; the transport only carries it.

```ts
type Frame =
  | TurnEvent | THostEvent
  | { type: "transport:seed"; turns: Turn[]; pending: Turn[] }   // first on every connect; again on lost continuity
  | { type: "transport:end" };

type AgentCommand =
  | { type: "send"; id: string; message: string }
  | { type: "resume"; id: string; answers: DeferredAnswer[] }
  | { type: "compact"; id: string }
  | { type: "cancel" }
  | { type: "stop" };

type CommandOutcome = { accepted: true } | { accepted: false; reason: { type: string; message: string } };

interface AgentTransport<THostEvent, THostCommand> {
  events(signal: AbortSignal): AsyncIterable<Frame>;
  command(command: AgentCommand | THostCommand, signal: AbortSignal): Promise<CommandOutcome>;
}
```

**The two ends and the wrappers.**

```ts
const remote = new RemoteAgent(transport);            // AgentOperations; state machine; owns no Transcript
const served = serveAgent(agentOrRemote, { seed });   // events(request): Response; command(cmd): Promise<CommandOutcome>
const transport = httpTransport({ events: url, commands: url });   // SSE + POST; SSE `id:` and Last-Event-ID for reconnect
const loopback = loopbackTransport(served);           // in-process; the test harness
function useAgent(agentOrRemote, onDeferred?) {}      // Transcript inside; returns turns, state, send, resume, cancel, deferred
```

`RemoteAgent.state` is one of `connecting`, `idle`, `busy { operation }`,
`waiting { calls }`, `ended`, `error`. The first and last two come from
the transport, the middle three from events.

**The deferred primitives**, Agent side.

```ts
deferredTool({ name, description, input: ZodObject, output: ZodType });   // zod only; importable in a browser

interface DeferredCall { id: string; name: string; input: Record<string, unknown> }
type DeferredAnswer = { id: string; output: JsonValue } | { id: string; error: string };

// AgentSession gains the held batch, in request order
deferred?: Array<
  | { id; name; status: "open"; input }
  | { id; name; status: "settled"; result: AxleToolCallResult }>;

// Turn stratum
interface DeferredAction {
  kind: "deferred";
  status: "pending" | "waiting" | "complete" | "cancelled" | "error";
  detail: { callId: string; name: string; input: Record<string, unknown>; output?: ActionResult };
}
// events, internal to the fold:
//   tool:request { kind: "deferred" }, tool:waiting, action:waiting, deferred:settled { callId, result }
```

## Decisions

Each with the reason and what it replaced.

**`RemoteAgent` implements the Agent's operation subset; the fold stays
outside.** `serveAgent` is written against the interface, so
`serveAgent(remoteAgent)` is legal and the shape chains: a hop is a
`RemoteAgent` facing upstream and a served agent facing downstream.
Three rules make the chain real: operation ids pass through unchanged;
every hop keeps a fold to serve seeds from; a deferred call is answered
at the hop that has a handler and forwarded otherwise. A loopback
transport over `serveAgent(agent)` drives the implementation. Rejected:
a `RemoteAgent` that owns its Transcript. It breaks agent-state
invariant 2 and the one-agent-many-sinks arrangement Sunnyday relies on
(a server Transcript for persistence, a browser one for rendering). The
consumption cost is paid once, in the hook, which returns both.

**One command channel carrying a union, not one endpoint per
operation.** The operation set stays in Axle: adding `resume` adds
nothing to any host's routes, and a host cannot end up with `send` and no
`cancel`. Same reason events are one union on one stream. The host keeps
lookup and auth and hands the Agent to `serveAgent`.

**Operations across a network return a handle synchronously.**
`accepted` settles on the command outcome; `final` is assembled from
events, so it also resolves for an operation another tab started. The
command carries an operation id and `pending:queued` and `turn:start`
carry it back; the local Agent has the id on `SettledOperation` already.
Refusals (`send()` while a call is waiting, `resume()` with nothing
open) are a rejected promise on the handle rather than a throw.

**Cursors are the transport's; the reset is the protocol's.** Sequence
numbers, cursor and server-side replay sit inside a transport that sees
every frame; `RemoteAgent` never sees a sequence number. The default does
what SSE gives for free. Lost continuity is different because the
consumer must act: the fold is wrong and has to be replaced. So the seed
frame is also the reset frame, and `Transcript.apply` starts over when it
sees one. AXL-44's "no cursors" becomes "inside the transport".

**Transcript and agent interface stay two things.** The agent interface
is the operation layer: what you can ask and what you hear back. The
Transcript is the Turn stratum's sink over what you hear back. The only
overlap is agent state a `RemoteAgent` re-derives from events (waiting
calls, the in-flight operation) because it has no other source; that is
the same state the local Agent holds in its session and scheduler, not
turn state.

**A deferred call is always a part and always fires the callback. Who
answers is the consumer's choice, not a mark on the tool.** The same
`ask-user` is buttons in one host, a scripted handler in a test, an
operator console in another. The part, `DeferredAction` in the family
with `ToolAction` and `ProviderToolAction`, exists whether code or a
person answers, so rendering is never conditional. `onDeferred` fires
for whoever registered the name, and the return value becomes the
`resume`. A UI is a handler whose body renders: it keys the question by
call id in UI state and resolves on click; the part view finds the
prompt by `detail.callId` and draws it at the part's position; the
handler's signal takes the prompt down when another tab answers first.
`deferred` on the interface is the waiting calls no handler has claimed.

**Callbacks live on the agent interface, not on the Transcript.** The
handler's return value has to become a `resume()`, and only the thing
that issues operations can do that. `onDeferred` is identical on `Agent`
and `RemoteAgent`; locally it resolves into `agent.resume()`, remotely
into a command. Rejected, in order: a `status: "deferred"` on
`ToolAction` that a renderer recognised by comparing the tool name and
re-parsing arguments; a `bind()` on a shared definition that typed the
same lookup; a second reducer beside the Transcript; callbacks on the
Transcript. All four put execution knowledge in the renderer or a return
channel on the fold.

**`deferred:settled` is keyed by call id.** The session carries no
transcript identity: agent-state invariant 1 is amended by one field,
invariant 2 is untouched. The Transcript finds the waiting part by
`callId` in whichever turn it sits, and "an event may update a part in
an earlier turn" becomes a stated rule.

**No new verb below the Agent.** `stream()` and `generate()` callers get
`stopped: "deferred"`, the held batch on the result, and a
`settleDeferred(batch, answers)` helper that builds the tool message.
They append it and call again.

## Behaviour the architecture docs will state

- `stream()` validates `input`, emits `tool:waiting`, runs the executable
  siblings, holds their results and stops without committing a tool
  message. One tool message per batch (tool-loop invariant 2) is why the
  siblings wait in the session.
- The deferring turn ends `complete` with no `reason`. The waiting part
  stays in the builder's open set, so a cancelled or errored turn cancels
  it under tool-loop invariant 9 unchanged.
- `send()` and `compact()` refuse while anything is waiting; the host
  declines through `resume` and resends. `cancel()` and `stop()` do
  nothing to waiting calls because nothing is running.
- `resume()` is an operation in the same FIFO. It validates each answer
  against the tool's `output`, emits `deferred:settled` per call, commits
  the one tool message merging held results and answers in request
  order, clears the batch and continues as an ordinary turn. It settles
  as `kind: "resume"`. Its result is an `AgentResult`, so a resume can
  defer again.
- `AgentResult` gains a third arm for a deferring send,
  `{ ok: true; deferred: DeferredCall[]; turn; usage }`. `turn:end` must
  carry what a remote `final` needs from it.
- `agent.onDeferred` with handlers for every call in a batch resumes
  automatically when they resolve; with any unhandled call the send
  settles with the deferred arm and the caller resumes by hand.

## Ticket split and order

AXL-103 becomes the Agent-side primitives, designed so the remote can
mirror them: `deferredTool`, the `stream()` stop and helper, the session
batch, `resume()`, `agent.deferred`, `agent.onDeferred`, the
`DeferredAction` part and its events, `DeferredCall` and `DeferredAnswer`
from the `ui` entry, the result arm, the operation id on `pending:queued`
and `turn:start`. It ships first. A host with its own connection can
render and answer a deferred call on it alone.

AXL-44 becomes the remote agent: the operation interface named,
`AgentTransport`, the frames and command union, `RemoteAgent` with its
state machine and handle matching, `serveAgent`, `httpTransport`, the
loopback, `Transcript` handling the seed frame, and the hook. Its "no
send and cancel" boundary goes; cursors and reconnection stay inside a
host's transport.

## Left open

- The name of the operation interface, and of the part if
  `DeferredAction` reads wrong next to `ToolAction`.
- Whether the local `send()` moves its refusals from a throw to the
  handle, for parity with the remote.
- Whether Axle ships the React hook under a subpath or documents it as a
  snippet; `ui` stays framework-free either way.
- What the seed frame carries for an in-flight operation so a handle
  created after `turn:start` can still match its `final`.
- Whether `snapshot()` becomes a command. Nothing needs it yet.
- Claim semantics when two handlers register the same name on one
  handle, and whether a handler can decline to claim.
- A `JsonValue` type for `DeferredAnswer.output`, if Axle has none.
- Remote `send` starts as a string plus host extensions. An `Instruct` can
  cross: Axle already emits JSON Schema from zod for every tool it sends a
  provider, so the schema travels the same way, variables are strings, and
  files are references the host already uploads separately. Nothing needs
  it yet, so it is deferred, not ruled out.
- What a remote `final` resolves to. Locally `response` is
  `instruct.parse(final)`. The remote owns no Transcript, so the final
  text has to reach it some other way, on `turn:end` or by the handle
  folding only the current turn's text; once it does, the client holds
  the zod schema and can parse locally. Until an Instruct crosses, the
  outcome only (`ok`, `failure`, `reason`, `usage`, `deferred`) with the
  hook handing out turns for content. Principles 1 and 6 meet here.
- Where the seed frame enters the Transcript. `Transcript.apply` takes
  `TurnEvent | THostEvent`; a `transport:seed` is neither. Either the
  Transcript learns one protocol frame or the hook, which owns the
  Transcript, replaces it on a seed. Leaning: the hook.
- Who holds the handle of an automatic `resume`. The send's `final` has
  already resolved with the deferred arm when handlers answer; the
  resume's handle is returned to nobody and settles only through
  `onSettled` as `kind: "resume"`. Leaning: that is the rule, stated.

## Terms to add

Deferred tool; waiting call; answer; resume (the operation); the
operation interface; command; frame; seed; served agent; remote agent;
hop. "Open" was tried for the waiting status and dropped because it reads
as something the consumer does.

## Prototype (2026-11-04, uncommitted working tree)

The shape above was implemented end to end the same day to test whether it
holds: the Agent-side primitives, the `DeferredAction` part and its events,
`serveAgent`, `RemoteAgent`, an SSE-and-POST transport and a loopback. It
is proven by tests under `packages/axle/tests/deferred/`: `stream()` stops
and `settleDeferred` closes the batch; the Agent defers, refuses `send()`
while waiting, resumes, persists and restores the batch, and resumes itself
through `onDeferred`; a `RemoteAgent` over a loopback sends, defers,
resumes and is refused with the local shapes; a second consumer is seeded
with the waiting call and settles the first one's prompt; a two-hop chain
answers `read-config` at the hop and `ask-user` in the browser; and the
same flow runs over a real HTTP server whose first event connection is
dropped after three frames and replayed from `Last-Event-ID`. The whole
repo typechecks, 1611 tests pass, and both packages build.

Where the prototype diverges from the shape above, and why:

- **Partial resume.** A `resume()` may answer a subset of the waiting
  calls. The Agent records the answers into the held batch, emits
  `deferred:settled` for each at once (outside any turn), and opens the
  turn only when nothing is left open; a partial resume settles through
  `onSettled` with the deferred arm and no `turn`, so `turn` on
  `AgentDeferredResult` is optional. Forced by the hop test: a hop can only
  answer the calls it has handlers for, and a UI with two questions answers
  them one at a time. `onDeferred` on both sides answers what it has
  handlers for rather than all-or-nothing.
- **`on()` carries turn events only; `onFrame()` carries everything.** A
  `TurnEventCallback` cannot be handed a seed, so the Agent-parity `on`
  stays narrow and the hook reads control frames from `onFrame`.
- **`RemoteAgent` keeps a private fold.** To produce `turn` and `response`
  on `final` with the local shape it folds the conversation itself, as the
  Agent keeps a per-turn `Transcript` for the same reason. It is not
  exposed; the hook still owns the consumer's Transcript.
- **The seed frame carries `deferred` explicitly**, from `agent.deferred`,
  rather than being scanned out of turns.
- **`AgentHandle` gained `refused`.** A refusal is a rejected `final` and
  the same error on `refused`, so `serveAgent` can answer the command path
  without racing the promise.
- **`compact` is accepted blind.** The Agent mints the compaction id, so a
  remote `compact()` cannot match its turn; `cancel()` and `stop()` return
  acceptance, not the local boolean.
- **The part field is `result`, not `output`**, so `DeferredAction` reads
  like every other action part.
- **`Transcript.waiting`** exists beside `agent.deferred`: the first is the
  parts for a renderer, the second the calls for a handler.
- **The CLI** reports a deferred turn as a failure; it registers no
  deferred tools.
- **Not built:** the React hook, an `Instruct` crossing the wire, host
  commands beyond a pass-through, and claim semantics for two handlers on
  one name (last registration wins).
