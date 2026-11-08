# Remote agent: a served Agent, an event store, and a consumer elsewhere

**Status**: current · **Last design revision**: 2026-11-07 (0.36.0, AXL-44)

This document is normative for how an `Agent` is driven from another
process: what crosses the wire in each direction, what the consumer side
may rely on, and where the library stops and the host begins. Code and
tests are built against it; divergence is a defect. Vocabulary is defined
in [terminology.md](../terminology.md). How the Agent itself owns state is
in [agent-state.md](./agent-state.md), whose sections _The stream numbers,
not the Agent_ and _A send crosses as a rendered prompt_ record the two
decisions this document builds on; deferred tools, which a remote consumer answers,
are in [tool-loop.md](./tool-loop.md).

## The pieces

```
browser ──http──▶ front door ◀──▶ (host's forwarding) ◀──▶ served agent
RemoteAgent       toEventStreamResponse                     Agent
httpTransport     parseAgentCommand                         InMemoryEventStore
                  (host's command switch)
```

The remote agent is RPC. Axle owns the spec, `AgentCommand` in and
`CommandOutcome` back as Zod schemas with the types inferred from them; the
one shipped client, `RemoteAgent` over any `AgentTransport`, with
`httpTransport` to read Server-Sent Events and post commands; and the
decoding, `parseAgentCommand`, which checks an untrusted body against the
spec. It also supplies the `Agent`, the `InMemoryEventStore` beside it, and
`toEventStreamResponse` to write a subscription as Server-Sent Events.
`loopbackTransport` is the same contract with no wire, for tests and for a
hop that serves an agent in its own process. The host supplies the
dispatch, a switch that turns each command into an Agent call, along with
routing, authentication, agent lifecycle, and any forwarding between the
front door and the process the agent runs in.

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
   the store sees them and not only the one that asked.
3. **Delivery is exactly once and in order, and the store is what makes it
   so.** `Transcript` is not idempotent: `turn:user` appends, `text:delta`
   concatenates. The `InMemoryEventStore` stamps every event with `<store id>-<seq>`
   as it happens; `subscribe(signal, after)` registers before it replays,
   so an event appended during the replay is delivered once; a transport
   resumes with the last cursor it delivered; and the SSE `id:` is that
   cursor, so `Last-Event-ID` is the resume point with no second field.
   The Agent itself emits plain events and knows nothing of numbering.
   Every event is sequenced; the agent's status is not an event, and the
   store keeps it beside the log (invariant 8).
4. **A cursor is owned by one store.** A store replays after a cursor it owns
   and from the start for any other, including one from a store that no
   longer exists. That fall-through is the restart: a new conversation is
   a new `Agent` with a new `InMemoryEventStore`, a client holding the old cursor
   reconnects and sees the new store from its beginning, and nothing resets
   anything on the client. A host that keeps a baseline for a cold open
   sends it as its own event, as Sunnyday's `stream:reset` is; the library
   has no reset frame. A host that lost an agent, to a restart or a
   release, holds a new agent if it brings one back, and says so: it
   answers `410` on the old stream, so the client ends and every open
   `final` rejects, or it serves the new agent at the same URL with its
   baseline event and accepts that a send from before is never settled,
   since only the lost process could have ended it. Serving a fresh agent
   as if it were the old one, with neither, leaves a client showing the
   old status and holding sends that never settle; that is the host's to
   prevent, and nothing in the protocol detects it.
5. **Host events share the store and never touch the remote's status.** The
   store is generic over the host's event type; `push` stamps a host event
   in sequence with the agent's; `RemoteAgent.on` delivers both with their
   cursors; `RemoteAgent.status` comes from the opening status and the
   agent's `operation:start` and `agent:idle` alone. A host event never
   uses those types, nor `type: "welcome"`, which the protocol uses.
6. **A send crosses as a rendered prompt.** The `send` command is
   `{ type: "send", id, prompt, files?, metadata? }`: the user turn's `id`,
   `instruct.render()` with the inputs, references, context sections and
   output-format instructions already in it, the Instruct's files, and the
   metadata the send or the Instruct carries. The schema never crosses;
   the client that holds it parses, so the remote's `send(instruct).final`
   gives `response` as the parsed object, and a parse failure is the
   `parse` failure kind as it is locally. A file crosses with its source
   as it is. A `ref` means whatever the `fileResolver` the host passes to
   `agent.send` makes of it, so a client and server that share storage
   name a file by its key without minting a URL; the client chose the
   `ref`, so the resolver authorizes the caller before reading it. Whether
   to accept files at all is the host's policy. Per-send request options (`reasoning`,
   `maxOutputTokens`, `toolChoice`, `providerOptions`) do not cross; the
   served agent's configuration applies.
7. **The remote reads like the local, minus what cannot cross.**
   `RemoteAgent` has `on`, `status`, `onToolCall`, `toolCall(id)`,
   `send`, `cancel`, `stop`, `clear`, and adds `connection`,
   `onConnection` and `close`. `on` delivers the same events `agent.on`
   does, and the host's, in order, each with its cursor; the opening
   status is the protocol's and is not delivered. `cancel`, `stop` and
   `clear` have the Agent's meaning: the active turn, the active turn at
   its batch boundary, the queue. A remote `send` returns a `RemoteHandle`
   with `final` only; it has no `cancel`, because a queued remote send
   cannot be cancelled by id and a handle that cancels only sometimes is
   not a handle. A remote `onToolCall` handler receives the call and no
   `ToolContext`: no `emit` for progress, no `signal`; cancellation is
   visible from the events. A `RemoteAgent` holds no transcript; it folds
   each turn only to produce `turn` and `response` on `final`, as the
   Agent does. `final` settles when the served operation ends, not when
   its turn does: at the operation's own `turn:end` the remote builds the
   result and holds it, and on `operation:end` with the same id it
   resolves with it (`complete`), rejects with `AxleAgentAbortError`
   (`cancelled`), or rejects with an `AxleError` carrying the message
   (`error`), so it settles after the continuation and `onSettled` as a
   local handle does. A `pending:dropped` rejects at once only for a send
   that never started; one that started waits for its `operation:end`.
8. **Status is synced, not streamed.** The agent owns its status and
   emits no status event (agent-state.md invariant 13). What crosses is the
   served side's status at the moment a consumer subscribes, because
   history and the live server can disagree: a consumer that resumes after
   an operation started has skipped its `operation:start`, and a server
   that restarted has a history that says nothing of what it is doing now.
   `AgentTransport.events` resolves to an `AgentSubscription`: `welcome`,
   `{ type: "welcome", status }` with the status when the stream opened,
   and `items`, the events after the cursor followed by live events. The store keeps that status by folding its own
   log, `operation:start` to busy with that id and `agent:idle` to idle,
   seeded once from `agent.status` when it is built, so a store built while
   its agent is busy opens busy and the opening status always describes the
   log the store is about to replay, however it is fed. After the opening
   status, a consumer applies the same two rules to the events in order,
   replay and live alike, and updates `status` before `on` delivers the
   event that moved it. A replay can move status briefly; it ends at the
   opening value, because the replay is the store's log up to that moment.
   Over SSE the welcome is a message with `event: welcome` and no `id`,
   written first on every response, so every reconnect brings a fresh one,
   which a transport delivers among the items; every later message is an
   event with its cursor as `id` and no `event`. A welcome never carries an
   empty `id:`, which would reset the resume point. `toEventStreamResponse`
   takes the subscription and cannot open without a welcome; `httpTransport`
   fails a stream that does not open with one. On the consumer, the connection and the
   status are separate: `connection` is `connecting` until `events`
   resolves, then `open`; `ended` when the items end or `events` resolves
   with no subscription because there is no agent to subscribe to; `error`
   with the error that was thrown, so a consumer reads a transport's own
   detail, such as `HttpTransportError.status`, from it; `status` is `idle`
   until the stream opens, and already reads the opening status when
   `onConnection` reports `open`. So `status` is current whenever `on` or
   `onConnection` fires, and a consumer that snapshots it from both misses
   no change.
9. **A `RemoteAgent` stands in for an `Agent` wherever an agent is
   served.** `InMemoryEventStore` takes either, and a host's command switch
   makes the same calls on either, so a hop is a consumer facing upstream
   and a server facing downstream, and a call is answered at whichever hop
   has the handler for it. This is the test that the client side is
   complete: a member the served side needs and `RemoteAgent` lacks, or a
   noun that means something else on it, is a defect in `RemoteAgent`, not
   a case for the host to special-case. The two-hop tests hold it,
   including that the far `final` waits for the origin's `onSettled`. Two
   gaps are known: a remote result carries no `after` list, since the
   inline sends' schemas live on the served side, and an `error` outcome
   crosses as its message, not as the error the served side threw.
10. **The HTTP transport reconnects on drops and on the served side being
    away, and stops on being told the agent is gone.** One URL: `GET` for
    the stream, `POST` for a command. A closed socket, a network failure
    or a `5xx` on reconnect is retried after `reconnectDelayMs`, doubling
    to `maxReconnectDelayMs`, with no cap on attempts, until `close()`; a
    stream that opens resets the wait. A `404` or `410` ends the agent, on
    the first connection as on a reconnect: either says there is no agent
    at that URL, and a wrong URL and an ended agent cannot be told apart.
    Any other failed response is the `error` state, since retrying a `401`
    changes nothing. The first connection does not retry, so a server that
    is down fails at once. A message the stream ended inside is not
    delivered, as the SSE protocol says, so a cut mid-packet replays that
    message whole from its cursor rather than parsing its prefix. A
    command does not retry; a failed `POST` rejects once.
11. **A host with its own database is its own event store.**
    `InMemoryEventStore` keeps every event until `close()`, which stops
    listening to the agent and ends every open subscription once it has
    delivered what it holds; a host calls it when it releases the agent,
    so a consumer reads `ended` rather than a stream gone quiet. A
    host that keeps events elsewhere does not use it: it stamps events
    with its store's own ids, which become the cursors, keeps the agent's
    status by the same fold, seeded from `agent.status`, and answers a
    subscription with `{ welcome, items }`, that status followed by the
    replay after the cursor and live events. The cursor's format is the store's; the
    transport and `Turn.cursor` treat it as an opaque string. A store that
    evicts must never trim behind a cursor a client may still hold, or must
    notice the hole and send its own baseline event; the library cannot see
    a host store's eviction.
12. **The spec and its decoding are Axle's; the dispatch is the host's.**
    A host reads a `POST` body with `parseAgentCommand`, which returns the
    typed command or `null` for anything the spec does not describe, and
    switches on `type` to call the agent itself. The switch is the host's
    because a real send is never a bare `agent.send`: it carries the
    host's `signal`, its `after` continuation, its `fileResolver`, its
    bookkeeping around the handle. Axle ships no dispatcher; the README's
    _Serving commands_ section and the reference server in `examples/`
    show the whole switch.

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
What survives is a numbered event store with replay, a rendered prompt on
the wire, and the Agent's own verbs as commands.

**The event store is the one piece of state beside the Agent.** Everything the
remote re-derives, it re-derives from events: the waiting call from
`action:waiting`, the open turn from `turn:user` and `turn:end`. The one
exception is the agent's status (2026-11-06): a continuation emits
nothing, so a consumer that resumes after the turn's `turn:end` cannot
derive that the agent is still busy. The served side therefore hands over
the current state and then the sequenced events, and a late joiner is still the
same code path as a reconnect. (Revised 2026-11-07: the status is synced on
connect and moved by lifecycle events; see _Status is synced_.)

**`Turn.cursor` is the one transport fact the fold learns.** Without it, a
client that renders from the database must still replay the whole store to
find where the live stream continues, and a long-lived agent makes that
replay the cost of every page open. With it, the stored turn carries its
resume point, and a stale cursor is the hard cut the host was going to
take anyway.

**The HTTP transport is one URL.** The transport names an agent, and
`GET` and `POST` on that name are the two directions. Two endpoints would
give a host one more thing to route and the transport one more thing to
configure for no case anyone has.

## State beside the events (2026-11-06)

Status first came from turn events on the remote, which was right until a
page reloaded during a continuation: it resumed after the stored turn's
cursor, nothing followed, and it read idle while the judge ran. Every way
of fixing that inside the sequence broke the sequence. A numbered status
event is skipped by a resume after it; re-sending it on connect either
takes a new seq, which every other consumer then sees, or reuses an old
cursor, which moves the resuming consumer backwards. So the stream carries
two kinds of event. Sequenced events are numbered and replayed. State
events are not: the current one is echoed on connect and each change is
sent with no position. The full reasoning and
the rejected alternatives are in agent-state.md, _Status is state_.

The same split answers the SSE question. A state message is still a
spec-compliant SSE message; it simply has no `id`, which the protocol
allows and which leaves `Last-Event-ID` where the last sequenced event put it.

## Status is synced (2026-11-07)

The state event did its job, a reload during a continuation reads busy, but
it made the stream two kinds of event and the Agent the emitter of a fact
about itself. The Agent now emits only history, its operation's lifecycle
included (agent-state.md, _Lifecycle is history_), and status is a property
anyone can read. Between two machines the protocol syncs it, once per
connection as its welcome, and the lifecycle events move it from there, which is exact
because status changes only where an operation starts and where the queue
empties. The store folds its own log rather than reading `agent.status` on
each subscribe, so a store fed late through a host's channel still opens
with a status that matches what it replays.

## Deferred (2026-11-06)

Each of these waits for a use that needs it, and the shape it would take
is recorded so the wait is cheap:

- **Trimming the in-memory store.** `InMemoryEventStore` keeps every event,
  every `text:delta` of every turn, for as long as the agent lives. A trim
  policy (by count, or behind the oldest cursor still held) waits for a
  long-lived agent served from memory.
- **An `EventStore` interface.** One type for anything with `subscribe`,
  so `loopbackTransport` could take a host's own store. Its one caller is
  the loopback, for tests; `Pick<InMemoryEventStore, "subscribe">` widens it
  without a new name the day a host needs it.

- **Cancel by id.** A `cancel` with an optional `id` naming a queued send,
  so a remote handle could cancel. It needs the served side to keep the
  handles its sends created, which the host's switch would keep in a map. Sunnyday sends one at a time.
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

- **An `Instruct` on the wire** (2026-11-05, reversed 2026-11-07): the
  `send` command carried `instruct.toJSON()`, every field plus the schema
  as JSON Schema, and the served side rebuilt it with `fromJSON`. Rejected:
  an `Instruct` is a description, which is data, plus a schema, which is
  behavior, and the round trip moved behavior across the wire only for the
  served side to re-render a prompt the client could render itself, while
  the parse that mattered stayed on the client. The client now renders and
  parses; data crosses.
- **`processAgentCommand`** (removed 2026-11-07): one exported
  function that decoded a command and made the agent call. Rejected when
  Sunnyday could not use it: its send needs a `signal`, an `after` judge
  and the handle, which a bare dispatcher cannot take without growing an
  option for every host need. Its two jobs split: the decoding became
  `parseAgentCommand`, the dispatch the host's switch (invariant 12).

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
- **A first connection answered `404` as an error** (2026-11-06): the
  first rule, on the grounds that a wrong URL should fail loudly. Rejected
  when Sunnyday met it: the same `404` on a reconnect meant `ended`, so one
  fact had two outcomes depending on when it arrived, and the `error`
  carried only a message, so the status was lost. A wrong URL and an ended
  agent both answer `404`; both are `ended`.
- **A shape check on each event from the wire** (2026-11-06): validating
  the parsed JSON before folding it. Rejected: the one real source of
  malformed data was a message the stream ended inside, which the SSE
  protocol says not to deliver, and the parser was fixed to say so. What
  remains is a server bug, and retrying a server bug replays it forever;
  the `error` state with the parse message is the right outcome.
- **`retain: "none"`** (2026-11-06): an `EventLog` that stamped and fanned
  out but kept nothing, for a host replaying from its own store. Rejected:
  such a host's store already numbers, replays and goes live, so the option
  handed it a counter it threw away. That host is its own event store
  (invariant 11).
- **A creation command in the protocol** (2026-11-06): `create` with a
  model and a system prompt. Rejected: an `Agent` is built from things
  that cannot cross, and every host already has a session creation call;
  see invariant 1.
