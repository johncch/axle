# Remote agent over a numbered log (AXL-44)

Working note for the landed design of the remote agent. The remote half of
[2026-11-04-remote-agent-and-deferred-tools.md](./2026-11-04-remote-agent-and-deferred-tools.md)
set out the principles and a prototype; this note records what was kept,
what was reversed, and why, over 2026-11-05 and 2026-11-06. Normative text
is in `docs/architecture/remote-agent.md`.

## What landed

- `EventLog` beside a served agent: every agent event and every host event
  stamped `<id>-<seq>`, kept or not, `subscribe(signal, after)` replaying
  after an owned cursor and continuing live with no repeat.
- `toEventStreamResponse(entries, request)`: entries as SSE with the cursor
  as `id:`.
- `processAgentCommand(agent, command)`: `send` with an `Instruct` as JSON,
  `answer`, `fail`, `cancel`, `stop`, `clear`; stateless.
- `httpTransport(url)`: `GET` the stream, `POST` commands, resume with
  `Last-Event-ID`, doubling reconnect wait with a ceiling, `404`/`410` end.
- `RemoteAgent<THostEvent>` over any `AgentTransport`; `loopbackTransport`
  for tests and in-process hops.
- `Turn.cursor`, recorded by `Transcript` from a `turn:user` or `turn:end`
  that carries one; `Instruct.toJSON()` and `Instruct.fromJSON()`.
- A live check, `remote-agent-roundtrip`, in the extended group: a schema
  crosses as JSON Schema, Haiku calls `ask_user`, a `RemoteAgent` answers,
  and the response parses on the consumer side.

## What was reversed, in order

1. **The seed frame, then a two-part seed, then a frame envelope.** Each
   was an attempt to give a late joiner the conversation so far without a
   full replay. Each added a representation of the conversation beside the
   events. The question that ended it: "either the server keeps the events
   or it drops them; why a third format?" A numbered log with replay
   covers reconnect and late joining; a baseline for a cold open is the
   host's own event, which Sunnyday already has.
2. **A cursor stamped by the Agent.** Landed in the morning as an instance
   id and a count on every event out of `emitEvent`, reversed by evening.
   Sunnyday pushes its own events onto the same stream, and the Agent
   cannot number what it never sees. The stream numbers.
3. **A string on the wire for `send`.** Sunnyday's send is already an
   `Instruct` with a context section and reference files, so the
   `Instruct` serializes and that is the unit on the wire. The schema goes
   too, as JSON Schema, since Zod 4.2 reads it back and refinements are the
   only loss.
4. **`cancel` on the remote handle.** It worked when the send was the
   active turn and did nothing otherwise. Removed; `RemoteHandle` is
   `final` only.
5. **A fixed reconnect interval, and ending the client on a `5xx`.** Both
   from the first `httpTransport` draft, both wrong for a deploy. Doubling
   wait with a ceiling; `5xx` is a drop.
6. **Delivering an unterminated final SSE message.** Added as a parser
   convenience, it turned a connection cut mid-message into a JSON prefix
   and an `error` state. The SSE protocol says not to deliver it; the
   parser now agrees and the reconnect replays the message whole.

## Where the cursor lives, and why that was argued twice

The cursor was first proposed on the event from the Agent, then on the
log's entries only, then also on `Turn`. The last step looked like a
transport fact leaking into the fold, and it is. It stays because of the
page that renders from the database: without a cursor on the stored turn,
that page must replay the whole log to find where the live stream picks
up, and for a long-lived agent that is the cost of every open. With it, a
stored turn carries its resume point, and a cursor from a dead log is the
hard cut the host was going to take anyway. One field, optional, absent
for every local fold.

## Grounding

Three times the design felt ungrounded and Sunnyday was read: for how its
`RunStream` numbers and resets, for how `buildAgentMessage` attaches files
by reference and a context manifest, and for how a second browser tab joins
a running assistant. Each reading removed something from the design rather
than adding to it.

## Left for a use

Cancel by id, per-send request options, `compact` on the wire, progress
from a remote handler. Recorded with their shapes in the architecture doc.
The next consumer is Sunnyday itself, whose transport this replaces after
the merge.

## Status as state (later on 2026-11-06)

A page that reloaded during a judge loop read idle while the agent was
busy. It resumed after its stored turn's cursor, the continuation emits
no turn event, and `RemoteAgent` derived its state from turn events. Every
fix that kept status in the sequence broke the sequence: a numbered status
entry is skipped by the resume, and re-sending it on connect either takes a
new seq that every other consumer sees or reuses an old cursor that moves
the resuming one backwards. A rule telling hosts to re-send it enforces
nothing.

What landed splits the stream into events, which are sequenced, and state,
which is last-wins:

- The scheduler owns `agent.status`, `idle` or `busy` with the operation's
  id, busy through settle and the continuation, and the Agent delivers each
  change on `agent.on` as `{ type: "state", status }`.
- `EventLog` never stamps or keeps state. `subscribe` returns
  `{ state, items }`; `toEventStreamResponse` takes that subscription and
  writes the state first as `event: state` with no `id`.
- `httpTransport` routes on `event: state`, because an SSE message without
  an `id` inherits the previous one in the parser.
- `RemoteAgent` splits `connection` from `status`, and `on` delivers
  everything, including the opening state.

Along the way: a separate `onStatus` on both sides was built and then
folded into the one `on`, since a consumer forwarding the stream would
merge them again; host state keys were dropped as derivable by the host;
and the pending queue stays out of state, because a queued send missed by a
resume still arrives as its turn and no command acts on one queued entry.
The rule that came out of it is that something is state only when the
events cannot rebuild it for a consumer that resumes.
