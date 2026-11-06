# Remote agent: a served Agent, a numbered log, and a consumer elsewhere

**Status**: current · **Last design revision**: 2026-11-06 (0.36.0, AXL-44)

This document is normative for how an `Agent` is driven from another
process: what crosses the wire in each direction, what the consumer side
may rely on, and where the library stops and the host begins. Code and
tests are built against it; divergence is a defect. Vocabulary is defined
in [terminology.md](../terminology.md). How the Agent itself owns state is
in [agent-state.md](./agent-state.md), whose sections _The stream numbers,
not the Agent_ and _A send crosses as an Instruct_ record the two decisions
this document builds on; deferred tools, which a remote consumer answers,
are in [tool-loop.md](./tool-loop.md).

## The pieces

```
browser ──http──▶ front door ◀──▶ (host's forwarding) ◀──▶ served agent
RemoteAgent       toEventStreamResponse                     Agent
httpTransport     processAgentCommand                       EventLog
```

Axle supplies the `Agent`, the `EventLog` beside it, `processAgentCommand`
to turn a command into an Agent call, `toEventStreamResponse` to write log
entries as Server-Sent Events, `httpTransport` to read them back and post
commands, and `RemoteAgent` over any `AgentTransport`. `loopbackTransport`
is the same contract with no wire, for tests and for a hop that serves an
agent in its own process. The host supplies routing, authentication, agent
lifecycle, and any forwarding between the front door and the process the
agent runs in.

## Invariants

1. **The protocol starts once an agent exists.** Every command is
   addressed to the one served agent the transport's URL names: `send`,
   `answer`, `fail`, `cancel`, `stop`, `clear`. Creating, finding, listing
   and ending agents are the host's, through its own API, because an
   `Agent` is built from a provider with its key, tools with their
   `execute`, MCP connections and a file resolver, none of which cross a
   wire. A host may create on first sight of an unknown id; that is its
   policy, and it must then keep ended ids apart so a reconnect to one is
   answered `410` rather than a fresh empty agent.
2. **Commands go in; everything else comes out as events.** A command's
   response is only whether the Agent took it: `{ accepted: true }`, or
   `not-waiting` for an answer to a call nobody is waiting on, `idle` for
   a cancel or stop with no active turn. Results, failures, the waiting
   call, the settled turn, are read from the events, so every consumer of
   the log sees them and not only the one that asked.
3. **Delivery is exactly once and in order, and the log is what makes it
   so.** `Transcript` is not idempotent: `turn:user` appends, `text:delta`
   concatenates. The `EventLog` stamps every entry with `<log id>-<seq>`
   as it happens; `subscribe(signal, after)` registers before it replays,
   so an entry appended during the replay is delivered once; a transport
   resumes with the last cursor it delivered; and the SSE `id:` is that
   cursor, so `Last-Event-ID` is the resume point with no second field.
   The Agent itself emits plain events and knows nothing of numbering.
4. **A cursor is owned by one log.** A log replays after a cursor it owns
   and from the start for any other, including one from a log that no
   longer exists. That fall-through is the restart: a new conversation is
   a new `Agent` with a new `EventLog`, a client holding the old cursor
   reconnects and sees the new log from its beginning, and nothing resets
   anything on the client. A host that keeps a baseline for a cold open
   sends it as its own event, as Sunnyday's `stream:reset` is; the library
   has no reset frame.
5. **Host events share the log and never touch the remote's state.** The
   log is generic over the host's event type; `push` stamps a host event
   in sequence with the agent's; `RemoteAgent.on` delivers both with their
   cursors; `RemoteAgent.state` is derived from turn events alone.
6. **A send crosses as an `Instruct`.** The `send` command carries the
   user turn's `id` and `instruct.toJSON()`: prompt, inputs, files,
   references, context sections, vars mode, metadata, and the schema as
   JSON Schema. A `ref` file resolves where the agent runs. The side that
   holds the Zod schema parses: the remote's `send(instruct).final` gives
   `response` as the parsed object, and a parse failure is the `parse`
   failure kind as it is locally. Per-send request options (`reasoning`,
   `maxOutputTokens`, `toolChoice`, `providerOptions`) do not cross; the
   served agent's configuration applies.
7. **The remote reads like the local, minus what cannot cross.**
   `RemoteAgent` has `on`, `onState`, `onToolCall`, `toolCall(id)`,
   `send`, `cancel`, `stop`, `clear`, `close`. `cancel`, `stop` and
   `clear` have the Agent's meaning: the active turn, the active turn at
   its batch boundary, the queue. A remote `send` returns a `RemoteHandle`
   with `final` only; it has no `cancel`, because a queued remote send
   cannot be cancelled by id and a handle that cancels only sometimes is
   not a handle. A remote `onToolCall` handler receives the call and no
   `ToolContext`: no `emit` for progress, no `signal`; cancellation is
   visible from the events. A `RemoteAgent` holds no transcript; it folds
   each turn only to produce `turn` and `response` on `final`, as the
   Agent does.
8. **Transport facts and conversation facts are separate states.**
   `connecting` until the transport's `events` resolves, then `idle` or
   `busy` from the events, `ended` when the iterable ends, `error` when it
   throws. A consumer that connects in the middle of a turn reads the
   replay and is `busy` before its first live event; over a log with
   `retain: "none"` it reads `idle` until that turn's next event arrives.
9. **A `RemoteAgent` can be served.** `processAgentCommand` and
   `EventLog` take an `Agent` or a `RemoteAgent`, so a hop is a consumer
   facing upstream and a server facing downstream, and a call is answered
   at whichever hop has the handler for it.
10. **The HTTP transport reconnects on drops and on the served side being
    away, and stops on being told the agent is gone.** One URL: `GET` for
    the stream, `POST` for a command. A closed socket, a network failure
    or a `5xx` on reconnect is retried after `reconnectDelayMs`, doubling
    to `maxReconnectDelayMs`, with no cap on attempts, until `close()`; a
    stream that opens resets the wait. A reconnect answered `404` or `410`
    ends the agent. Any other failed response is the `error` state, since
    retrying a `401` changes nothing. The first connection does not retry:
    a wrong URL fails at once. A message the stream ended inside is not
    delivered, as the SSE protocol says, so a cut mid-packet replays that
    message whole from its cursor rather than parsing its prefix. A
    command does not retry; a failed `POST` rejects once.
11. **Retention is the host's, within one rule.** `EventLog` keeps every
    entry (`retain: "all"`) or none (`retain: "none"`, for a host that
    stores entries itself and serves replay from there). A host store that
    evicts must never trim behind a cursor a client may still hold, or
    must notice the hole and send its own baseline event; the library
    cannot see a host store's eviction.

## Design rationale (2026-11-05, 2026-11-06)

The 2026-11-04 design note set out ten principles and a prototype with a
seed frame, a frame envelope, `serveAgent`, and an Agent-side resume
operation. The review of 2026-11-05 replaced the deferred-tool half with a
long tool call (see tool-loop.md), and the remote half was then rebuilt one
piece at a time against Sunnyday's actual transport and send paths. Each
piece was cut to the smallest thing that served a use Sunnyday has: a
browser that reconnects, a second tab joining a running agent, a page
rendered from the database that subscribes after the last turn it holds, a
person answering a question the model asked, a file attached by reference.
What survives is a numbered log with replay, an `Instruct` on the wire,
and the Agent's own verbs as commands.

**The log is the one piece of state beside the Agent.** Everything the
remote re-derives, it re-derives from events: the waiting call from
`action:waiting`, the open turn from `turn:user` and `turn:end`, its state
from those. The served side therefore has nothing to hand over on connect
but the entries, and a late joiner is the same code path as a reconnect.

**`Turn.cursor` is the one transport fact the fold learns.** Without it, a
client that renders from the database must still replay the whole log to
find where the live stream continues, and a long-lived agent makes that
replay the cost of every page open. With it, the stored turn carries its
resume point, and a stale cursor is the hard cut the host was going to
take anyway.

**The HTTP transport is one URL.** The transport names an agent, and
`GET` and `POST` on that name are the two directions. Two endpoints would
give a host one more thing to route and the transport one more thing to
configure for no case anyone has.

## Deferred (2026-11-06)

Each of these waits for a use that needs it, and the shape it would take
is recorded so the wait is cheap:

- **Cancel by id.** A `cancel` with an optional `id` naming a queued send,
  so a remote handle could cancel. It needs the served side to keep the
  handles its sends created, so `processAgentCommand` would hold state or
  the host would keep a map. Sunnyday sends one at a time.
- **Per-send request options.** A plain `options` field on `send` carrying
  the scalar members of `AxleModelRequestOptions`. Needed the day a UI
  gains a per-message reasoning toggle.
- **`compact` on the wire.** A remote consumer sees compaction happen and
  folds it; it cannot trigger one. Automatic triggers run on the served
  side.
- **Progress from a remote handler.** A command carrying an `emit` chunk
  for a waiting call. A remote answerer today is a person, not a
  long-running tool.

## Rejected alternatives

- **A cursor stamped by the Agent** (2026-11-05, reversed the same day):
  recorded in agent-state.md; host events share the stream and the Agent
  never sees them, so the stream numbers.
- **A seed frame and a frame envelope** (2026-11-05): a first message on
  every connection carrying the host's folded turns, and a wrapper around
  every event to distinguish it from control frames. Rejected: a second
  representation of the conversation on the wire and a second shape in
  every consumer, when a numbered log with replay covers reconnect and a
  baseline is the host's own event.
- **A `cancel` on the remote handle that works when it can** (2026-11-06):
  cancelling the active turn when the handle's send happened to be it and
  doing nothing otherwise. Rejected: a handle whose `cancel` is sometimes
  a no-op is a lie about its contract; `cancel()` on the `RemoteAgent` is
  the Agent's and says so.
- **A fixed reconnect interval** (2026-11-06): one second, forever. Rejected
  for a doubling wait with a ceiling: the case that motivated retrying a
  `5xx` at all is a deploy, where every open tab would otherwise hit the
  front door in lockstep once a second.
- **Ending the client on a `5xx` during reconnect** (2026-11-06): the
  first draft threw on any failed reconnect but `404` and `410`. Rejected:
  a front door mid-deploy answered `503` and every open tab was dead until
  a reload.
- **A shape check on each event from the wire** (2026-11-06): validating
  the parsed JSON before folding it. Rejected: the one real source of
  malformed data was a message the stream ended inside, which the SSE
  protocol says not to deliver, and the parser was fixed to say so. What
  remains is a server bug, and retrying a server bug replays it forever;
  the `error` state with the parse message is the right outcome.
- **A creation command in the protocol** (2026-11-06): `create` with a
  model and a system prompt. Rejected: an `Agent` is built from things
  that cannot cross, and every host already has a session creation call;
  see invariant 1.
