# Operations, lifecycle events and the welcome (AXL-44)

Working note for the second pass over the remote agent and the Agent's
lifecycle. It supersedes parts of
[2026-11-06-remote-agent-over-a-log.md](./2026-11-06-remote-agent-over-a-log.md):
the `Instruct` on the wire, `processAgentCommand`, and status as a state
event on `agent.on`. Normative text is in `docs/architecture/agent-state.md`
(_Lifecycle is history_) and `docs/architecture/remote-agent.md` (_Status is
synced_).

## What landed

- **Commands are a spec.** `agentCommandSchema` and `commandOutcomeSchema`
  are the source of `AgentCommand` and `CommandOutcome`; `parseAgentCommand`
  decodes an untrusted body. The host owns the switch that turns a command
  into an agent call. `examples/remote/` is the reference host and client.
- **A send crosses as a rendered prompt:**
  `{ type: "send", id, prompt, files?, metadata? }`. The client renders the
  `Instruct` and parses the reply with its schema. Files cross with any
  source; a `ref` is read by the host's `fileResolver`, which authorizes the
  caller.
- **`loopbackTransport(store, handle)`**, a transport with the host's command
  function as its route, and `InMemoryEventStore.close()`.
- **Lifecycle events on `agent.on`:** `operation:start`, `after:start` and
  `after:end`, `operation:end` with the outcome, `agent:idle`. `Transcript`
  reports them handled and folds nothing from them.
- **Agent-wide `onStart`**, awaited before the turn opens; a throw refuses the
  start. **`onSettled` once per operation**, after the continuation; a throw
  is logged and never changes the result.
- **`threadId`** on an inline turn's message and user turn: the send's id,
  rooting a one-level thread.
- **The welcome.** Every served stream opens with `event: welcome`,
  `{ type: "welcome", status }`, read from the store's own fold of its log.
  The Agent emits no status event.
- **Remote `final` settles on `operation:end`**, after the continuation and
  `onSettled`, as a local handle does.

## What was reversed, in order

1. **An `Instruct` on the wire** (from 2026-11-05). `toJSON()`, `fromJSON()`
   and `InstructJSON` are gone. An `Instruct` is a description, which is
   data, plus a schema, which is behavior; the round trip moved behavior
   across the wire only for the served side to re-render a prompt the client
   could render, while the parse that mattered stayed on the client.
2. **`processAgentCommand`** (from 2026-11-05). Sunnyday could not use it:
   its send carries a `signal`, an `after` judge and bookkeeping around the
   handle, which a shipped dispatcher cannot take without an option for
   every host need. Its two jobs split into `parseAgentCommand` and the
   host's switch.
3. **"Files cross as `url` or `base64` only"** (decided and reversed the same
   day). A client and server that share storage both know what a key means,
   so a `ref` crosses and the server's resolver checks access.
4. **Status as a state event on `agent.on`** (from 2026-11-06). The state
   event fixed the reload during a judge, but it made the stream two kinds
   of event and the Agent the emitter of a fact about itself. Status is now
   a property the Agent owns; the lifecycle events mark where it changes;
   the protocol syncs it once per connection.
5. **Per-send `before` and `finally`** (proposed by Sunnyday, replaced the
   same day). Agent-wide `onStart` and a per-operation `onSettled` do the
   same jobs with one end hook instead of two; a closure versus a map keyed
   by id is a style choice.
6. **`onSettled` failures rejecting `final`** (proposed for Sunnyday's
   persistence errors, reversed before shipping). The hook is shared, so one
   broken callback would fail every send, and `final` reports what the agent
   did.
7. **Three earlier rejections, now reversed in agent-state.md:**
   `onSettled` once per operation (2026-10-14), an idle event (2026-10-09),
   and a parent id on inline turns (2026-10-14). Each carries its new reason
   there.

## The model that came out of it

An operation holds the queue, has a status, starts and ends, and fires the
hooks. A turn is what people see. The lifecycle produces turns and is not
made of them: one operation produces one exchange, several (a judged send
that asked for a fix), or none (a send refused by `onStart`). The transcript
stays a flat list of turns, and an inline turn's `threadId` says which
thread it replies in, as a chat app's reply does.

Events carry history, whether or not `Transcript` folds them. Status is not
history: it is what the agent is now, and history and the live server can
disagree after a resume or a restart, so the protocol tells a consumer once
on connect and the events move it from there.

## Considered and left

- **Inline sends as their own operations**: queued behind later sends, the
  judge runs after the next message; nested, status and cancel must choose.
- **`sendFirst`**: outside a hold, the next send has already started by the
  time the judge returns; inside `onSettled`, it rebuilds the design rejected
  on 2026-10-09.
- **Taking `after` out of the lifecycle**: it holds the queue, so it is
  lifecycle whatever it is called, and `final` would stop meaning done.
- **A judge inside a terminal tool**: simpler and needs nothing from Axle,
  but the judge runs mid-turn; worth recommending for judges that can work
  from the model's answer.
- **`return false` from `onStart`**: a throw carries the reason, and
  `agent.cancel()` inside the callback refuses as a cancel.

## Known gaps

A remote result carries no `after` list, since inline sends' schemas live on
the served side; an `error` outcome crosses as its message. Both are
recorded in remote-agent.md invariant 9, to revisit when a remote consumer
reads them.

## Turn timeout and stream stall (later on 2026-11-07)

Sunnyday asked for both: its two agents each armed a timer around
`agent.cancel("timeout")`, and nothing bounded a provider socket gone silent.

- **`turnTimeoutMs`**, on the agent or a send, bounds one turn from
  `turn:user` to `turn:end`, deferred waits included, since it is meant as a
  long limit on runaway turns. It first landed as a timer calling
  `cancelCurrent`, which cancelled the whole operation, so a judge's fix
  turn running long threw away a good draft. It now runs the turn on its own
  signal, the operation's combined with the timer: the rejection goes where
  the turn's outcome goes, `final` for the send's own turn and `ctx.send()`
  for an inline one, where a judge can catch it and keep the draft. The
  reason is typed, `{ type: "timeout", limitMs }`, carried on
  `AxleAgentAbortError` and on `operation:end`'s `cancelled` outcome.
  `AbortSignal.timeout` was weighed and left: its reason is a generic
  `TimeoutError`, which Axle's own request retry also produces, so telling
  them apart would be a string check again. A per-send value does not flow
  to inline turns: a turn reads its own value, then the agent's.
- **`streamStallMs`**, on `stream()`, the agent or a send, is the longest gap
  between chunks on one step. Read from the SDK sources, no provider bounds
  it: three stop timing at headers and Gemini's is a total deadline
  (providers.md, _Timeouts on a streaming request_). A stall fails the step
  `api`, `type: "StreamStall"`, never retried, because past the first chunk
  a retry would replace an answer the consumer was already shown. The
  watchdog races each chunk read, so a provider blocked on a dead socket
  that never notices its signal is still stopped; a cancel during the wait
  still keeps its partial.
- **`timeoutSignal(parent, ms)`**, internal, returns a signal with `reset()`
  and `Symbol.dispose` that aborts with `{ type: "timeout", limitMs }`, and
  is a no-op with no `ms`, so each timer is one `using` line with no
  conditional: the turn timeout, the stall watchdog, and Chat Completions'
  attempt timer, which turns the timeout into the `DOMException` it already
  threw. `using`
  is server-side only, as Safari has not shipped it.
