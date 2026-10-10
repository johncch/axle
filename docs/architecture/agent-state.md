# Agent state: the continuation and the transcript

**Status**: current · **Last design revision**: 2026-10-09 (0.34.0)

This document is normative for how conversation state is owned and
persisted. Code and tests are built against it; divergence is a defect.
Vocabulary is defined in [terminology.md](../terminology.md).

## Invariants

1. **The Agent is a continuation, not a record.** `AgentSession =
{ sessionId, messages }` — the session id and the active model-facing
   conversation, nothing else. `agent.snapshot()` returns exactly this;
   `new Agent(config, session)` restores it. Unknown keys in stored
   sessions are ignored.
2. **The Agent holds no transcript.** It emits `TurnEvent`s; whoever wants
   a transcript folds them with the shipped in-memory `Transcript` and stores
   its turns. Lose those turns, lose the transcript — the Agent cannot recreate
   it. Internally the Agent keeps only a turn-scoped fold to build
   `result.turn`, discarded when the operation settles.
3. **The event stream is the only channel between engine and transcript.** Hosts
   attach with `agent.on(...)`; there is no injected store, no engine-side
   read-back, no `session:restore` event. Restore means the host re-seeds
   its own transcript (`new Transcript(savedTurns)`) from its own copy,
   persisted next to the `AgentSession` in one atomic write.
4. **Historical messages are disposable.** Compaction replaces `messages`
   and the old ones cease to exist. Lookback is served by the transcript; hosts
   wanting pre-compaction messages (undo/fork, exact-request audit) copy
   them themselves before returning from their compactor.
5. **A user message commits together with its turn event.** Once `turn:user`
   is on the wire, the message is in the conversation — transcript and messages
   cannot diverge. Nothing is committed before genuine setup (such as MCP
   resolution) succeeds; until then the send is only a pending entry
   (invariant 7), which commits nothing. `Agent.send()` clones and validates
   its `Instruct` and materializes the `AxleUserMessage` and its user turn
   synchronously before scheduling; execution emits that same turn as
   `turn:user`, then the same `Instruct` parses the final assistant response.
6. **Usage accounting is host-domain.** Every `turn:end` carries
   `turn.usage`; hosts accumulate totals in their own storage. The Agent
   exposes no usage meter, and `AgentSession` carries none.
7. **Pending is live state, kept apart from turns, and shaped like them.**
   An operation — a send or a manual compaction — is announced with
   `pending:queued` when the Agent accepts it, carrying a preview `Turn`
   with `status: "pending"` and the id the real turn will carry: for a send
   the user turn itself; for a compaction an agent turn holding one
   `pending` compaction part. `Transcript` holds it in `pending`, never in
   `turns`, and removes it when a turn with that id opens (`turn:user` for a
   send, `turn:start` for a compaction) or when `pending:dropped` arrives.
   A turn with `status: "pending"` therefore never appears in `turns`: the
   committed turn arrives under the same id with its real status. A drop
   means the operation ended before opening its turn and committed nothing:
   `cancelled` for a handle cancel, `clear()`, or an aborted signal; `error`
   for a failed setup. `turns` stays append-only. Pending turns are never
   persisted: hosts save `turns` only and `AgentSession` carries no queue,
   so a transcript restored from storage has none. The constructor takes
   `pending` only to mirror a live transcript, and discards any entry whose
   id is already in `turns`. `snapshot()` opens no turn and is neither
   queued nor pending (invariant 10).
8. **The Agent hands over the session and the outcome when an operation
   settles, and waits for the host.** `agent.onSettled(...)` fires once for
   every operation that ran, however it ended: after its `turn:end` when it
   opened a turn, and before its handle settles, with the value `snapshot()`
   returns and a `SettledOperation` carrying exactly what the handle is
   about to settle with (`fulfilled` with the result, `rejected` with the
   reason) and the `id` its `pending:queued` turn carried, so a host follows
   one operation from queued to settled without counting. An operation cancelled while still queued never ran and does not
   fire. Callbacks run together and are awaited: the handle does not settle
   and the next queued operation does not start until every callback has
   settled, so a host that reads its `Transcript.turns` inside the callback
   holds turns and messages that match exactly, and nothing from the next
   operation is observable before the callback resolves. The operation is
   already done while callbacks run: `cancel()` and `stop()` return `false`
   in that window, and the callback receives no signal — the work inside it
   is the host's to cancel. The callback is its own channel: the session
   never rides the turn event stream, which hosts forward to clients. A
   callback reports an outcome and cannot change it: one that throws or
   rejects is caught, recorded on the trace, and does not stop the other
   callbacks or alter the handle's result. `snapshot()` remains the pull
   form and waits for the Agent to go idle.
9. **Events carry the transcript; hooks carry lifecycle.** Turn events
   (`agent.on`) are synchronous fan-out and each one changes what a
   `Transcript` holds: hosts forward them to clients, and nothing listening
   can hold the engine. Lifecycle goes through hooks, and whether a hook is
   awaited is a property of that hook. `onSettled` is awaited: it is the
   host's control channel at the one rest point, able to hold the queue,
   carrying what must not ride the event stream. Work that has to finish
   before the next operation starts goes there. `onIdle` is not awaited: it
   reports that the Agent went from busy to idle. The scheduler owns the
   rest point as a task state (`queued`, `running`, `settling`, `settled`);
   the Agent adds no flag of its own. The Agent's tool and skill registries
   are live state the host changes at any time; the Agent hands their
   current values to `stream()` when a turn opens and at every tool-batch
   boundary, and `stream()` holds no registry ([skills.md](./skills.md)).
10. **The Agent says when it goes idle.** `agent.onIdle(...)` fires each
    time the scheduler finishes a task and nothing is queued behind it: after
    that task's `onSettled` callbacks have settled and its handle has been
    settled. Only the scheduler knows this moment, so the host is told
    rather than left to work it out from settles and drops. A `clear()` that
    empties the queue while the last operation settles is covered, because
    the scheduler looks at the queue only afterwards. Work scheduled during
    the last `onSettled` keeps the Agent busy and defers the firing. The
    callback takes no arguments and is not awaited: the Agent is already
    free, so a `send()` from inside it starts at once. A callback that
    throws is caught and recorded on the trace. Only operations make the Agent
    busy, so every firing follows at least one `pending:queued` and every
    `pending:queued` is followed by a firing: a host that opens something
    opens it there, not before the call, since `compact()` with no
    compaction configured schedules nothing. `snapshot()` is not queued
    work. It resolves at once when the Agent is idle and otherwise at the
    next change to idle, so it is always at rest, includes everything that
    was queued, causes no firing, and is not cancelled by `clear()`.

## Design rationale (2026-08-12)

The Agent's two data structures have different mutation semantics and
therefore different owners. **Messages** are folded working memory: compaction
rewrites them, the past disappears from them by design, and the model needs
them hot on every request — they belong to the Agent, and they are bounded by
construction (compaction is the bound). **Turns** are an append-only fold of
the event stream — the chronological record of what happened. They are not a
projection of messages: messages lack timing, thinking, errors, aborted turns,
annotations, and child-agent detail, and post-compaction they lack the past
entirely. Turns are `fold(events)`, and the fold ships as `Transcript`.

The pre-0.30 `History` glued the two together inside the Agent, which was
neither-here-nor-there: the Agent didn't enforce coherence between them,
carried turns only as a convenience, yet paid unbounded growth and
serialization weight. The fix was a deletion: turns left the Agent entirely,
and the unused session-annotation target was removed rather than moved into
the transcript. Session-wide application state belongs to the host. Consumers
that already ran their own folds paid nothing; the engine stopped holding
state it didn't own.

Consequences that fall out of the split: a DB-backed transcript is just a
subscriber with storage (no shared axle interface until a second
storage-backed implementation wants one); compaction events are natural
chapter boundaries for hosts that rotate storage; and there is deliberately
no retrieval/paging API on the Agent — deep-history readers are host-storage
readers, exactly as they already are for messages.

Semantic memory follows the same ownership boundary. The Agent has no memory
service or automatic recall/record lifecycle. Model-directed retrieval and
writing are ordinary tools; deterministic host-directed context is supplied
through `Instruct.addContext()`. Complete transcript persistence consumes the
turn event stream instead of masquerading as semantic memory.

## Pending and settle (2026-10-08)

Hosts could not render work the Agent had accepted but not started. A send
made during an active turn was a closure in the scheduler until `turn:user`;
a queued manual compaction was the same; `clear()` and a cancelled handle
rejected a promise and emitted nothing. Hosts kept their own lists and could
not keep them correct, because no event tied a `turn:user` to its send.

The queue belongs to the Agent, so the Agent announces it. The fold belongs
to `Transcript`, so `Transcript` holds it. What made this hard was that
`turns` has always been append-only and durable, and a pending entry is
neither. The resolution was to stop trying to make one collection serve
both: `turns` is the record, `pending` is live state, and the persistence
contract (save `turns`, restore through the constructor) is unchanged and
discards pending by construction.

One rule covers every kind of operation: an entry is keyed by the id of the
turn it will open, and that turn opening is what resolves it. A send's turn
id is its message id, known at `send()`; a manual compaction's is chosen at
`compact()`. (Entries were first a tagged union with a `kind`; they became
preview turns the next day, see below.)

Saving had the mirror-image problem. `snapshot()` is at rest because it
waits for the Agent to go idle, which means that with five sends queued a
save requested after the first one resolves after the fifth. `onSettled` hands the session over at each
rest point instead of making the host wait in line for it, and it fires at
the one moment the host's transcript and the Agent's messages are known to
agree.

Accepted consequences:

- **Graceful shutdown is `clear()`, then `stop()` or `cancel()`, then
  `snapshot()`** (or the last `onSettled`). Pending is empty at save time
  because it was cleared, and connected clients received the drops.
- **A crash, or a save taken while work is queued, loses the queued
  operations.** After restore the pending rows are gone and nothing recorded
  them — the same loss a mid-stream turn already had. A host that needs
  queued input to survive a restart keeps its own inbox, written on
  `pending:queued`.
- **A failed or cancelled manual compaction still fires `onSettled`** with
  unchanged messages. One redundant save buys a one-sentence rule.
- **An automatic compaction inside a send does not fire on its own.** It is
  part of that send, whose single firing includes it.

## Pending entries are turns (2026-10-09)

A pending entry was first a tagged union: a send carried a preview user
turn, a compaction carried only an id. The CLI rendered them through a
`kind` switch rather than its turn component, and a browser mirroring a
live server transcript could not seed them, since the constructor took only
`turns` and the doc read that as "pending is never constructed".

The `Turn` type was designed so a host renders a transcript with one
component in one loop. A pending entry that is not turn-shaped breaks that
for the one list the host most wants to draw next to the turns. So a
pending entry is now a `Turn` whose `status` is `"pending"`, built by the
Agent at the moment it accepts the operation: a send's preview is the user
turn it will commit (`send()` already built it); a compaction's preview is
an agent turn with one compaction part in `pending`, the part vocabulary
action parts already use. `transcript.pending` is a `readonly Turn[]`, and
`[...turns, ...pending]` renders with one component keyed by id, the
committed turn replacing its preview in place.

The constructor takes `pending` as a second positional list for the mirror
case, two lists of the same thing beside the two getters. An options object
was considered and dropped: nothing else wants a constructor option, and
`{ pending }` says nothing the position does not. A combined
`transcript.state = { turns, pending }` was also dropped, because it makes
`save(session, transcript.state)` the obvious call and that call would
persist pending, which a restore would then show as queued rows no queue
backs; `AgentSession` excludes the queue for the same reason. The
persistence rule does not move: hosts save `turns` only, and nothing
restores pending from storage. Seeding discards an entry whose id is already in `turns`,
because the fold resolves an entry only when its turn opens or it is
dropped, and a turn that opened before the client's stream cursor is never
replayed.

Accepted consequences:

- **`"pending"` joins `TurnStatus` and the compaction part's status.** An
  exhaustive switch over either gains a case. A `pending` turn lives only
  in `transcript.pending`; renderers that only read `turns` never see one.
- **The preview and the committed user turn are no longer the same
  object**: `send()` emits `{ ...userTurn, status: "pending" }` and commits
  `userTurn` as `complete`. Same id, same parts, same timing.
- **A host seeding a mirror captures `turns`, `pending` and its stream
  cursor in one synchronous read** of the server's transcript. The
  constructor's discard covers ids already in `turns`, not an entry whose
  turn opens between the read and the cursor.

## Awaited settle and the outcome (2026-10-09)

The first host outside the CLI to adopt `onSettled` snapshots a sandbox
between turns. With a synchronous callback the scheduler started the next
queued operation the moment the callback returned, so the next turn's tool
calls overlapped the snapshot; the CLI had lived with the same gap by
chaining its saves on a promise of its own. The same host emits a
"turn finished" signal that needs the operation's result, which only the
handle carried, and the handle resolves on a microtask the next turn's
`turn:user` could in principle beat.

The resolution puts the rest point in the scheduler. A task's lifecycle is
one state, `queued → running → settling → settled`; the scheduler awaits
the operation's settle step between the work finishing and the handle
resolving, and hands that step the work's own outcome as a
`PromiseSettledResult`. "Before the handle settles" is then enforced by
construction, cancellation during the window is a no-op because the state
says so, and the outcome reaches the hook without a second shape.

Firing for every operation that ran, rather than only those that opened a
turn, fell out of the same move. The old rule existed because a drop had
nothing to save; once the hook carries the outcome it is the host's
lifecycle channel, and a lifecycle channel that goes silent exactly when
setup fails is a worse one. The scheduler knows whether a task ran; the
Agent would have needed a flag to know whether it committed.

Accepted consequences:

- **A slow callback slows the queue.** That is the point. A host that does
  not want to hold the queue returns nothing from its callback; a host that
  starts async work and does not return the promise has fire-and-forget,
  as the CLI's chained saves do today.
- **Awaiting `snapshot()`, `compact()` or another send's `final` inside
  the callback deadlocks**, as it does inside a tool's `execute`: the
  callback holds the queue the others wait for, and the Agent cannot go
  idle for `snapshot()` until it returns. The session the hook passes is
  the one `snapshot()` would return.
- **A send that failed before its turn opened fires** with a rejected
  result and an unchanged session. A save-on-settle host writes one
  redundant save, the trade already accepted for a failed manual
  compaction. A send with an already-aborted signal therefore fires when
  the Agent was idle (it activated, ran, and threw) and not when it was
  busy (it was withdrawn from the queue); `pending:dropped` is emitted
  either way.
- **A synchronous callback now resolves the handle one microtask later**
  than before, since callbacks go through `Promise.all`. Nothing can
  observe it: the scheduler releases the slot only after that hop.

## Rejected alternatives

- **A `{ kind, turn }` pending entry** (2026-10-09): every entry would
  carry a turn, so one loop could render both lists, but `kind` restated
  what the turn already says (a user turn is a send; an agent turn with a
  compaction part is a compaction) and kept a second shape for hosts to
  learn. The compaction preview needed one part to be self-describing, and
  `pending` on a compaction part is the status action parts already have.
- **Marking pending on the entry rather than on the turn** (2026-10-09):
  "queued" is where the turn sits, not what happened to it, so a wrapper
  was tempting. But a renderer receives a `Turn` and must know how to draw
  it; a status it can read beats a flag the loop has to pass down. This is
  not the `queued` status in `turns` rejected on 2026-10-08: that put
  queued rows in the append-only record and in saved data, and both stay
  false, since a `pending` turn lives only in `transcript.pending`.
- **An `onStarting` hook** (2026-10-09): an operation has two rest points,
  before start and after settle, and they are the same instant — the end of
  N's settle is the moment before N+1 starts. The host can see what is next
  in `transcript.pending[0]`, and when the Agent is idle it preps before
  calling `send()`. A sibling hook with identical semantics would exist for
  no consumer.
  Amended the same day: `pending[0]` is what is next, not what started. It
  can still be dropped between the end of the settle and the start, so a
  host that opens something on it can be left holding it open. The start is
  the turn opening (`turn:user` for a send, `turn:start` for a
  compaction), and the first host to hit this wanted the end of the busy
  period rather than the start of each operation, which is `onIdle`.
- **Leaving the id off `SettledOperation`** (2026-10-09): a host would
  match settles to queued rows by position. A send that fails in setup
  emits `pending:dropped` and also settles, so a host that removes the row
  on the drop then credits the settle to the next row.
- **Putting the id on the handle instead** (2026-10-09): `compact()`
  returns a bare promise, and the hook exists so a host does not need the
  handle.
- **An idle turn event** (2026-10-09): every turn event changes what a
  `Transcript` holds, and going idle changes nothing there. It is lifecycle,
  so it is a hook.
- **Awaiting `onIdle`** (2026-10-09): the Agent is already free when it
  fires, so holding it would mean deciding what a `send()` during the
  callback does and whether the Agent is still idle afterwards. Work that
  must finish first already has `onSettled`.
- **`snapshot()` as a queued task** (2026-10-09): how it was built. It
  made the Agent busy, so a snapshot taken while idle fired `onIdle` with
  no operation before it, and the first host's "clear conversation" action
  did exactly that. A snapshot is not something the user asked the Agent
  to do; it only needs the Agent at rest, which is what idle means. Waiting
  for idle changes one case: `send(a); snapshot(); send(b)` now includes
  `b`.
- **Firing `onIdle` only after a send or a compaction** (2026-10-09): the
  other way to spare hosts that firing. The scheduler would have to
  remember what kind of task ran since the last firing, a flag beside its
  task state. With `snapshot()` out of the queue, "a task finished and
  nothing is queued" needs no memory.
- **An immediate `snapshot()`** (2026-10-09): with `onSettled` and `onIdle`
  a waiting snapshot has little left to do, but mid-turn the messages can
  hold a user message with no reply, and `agent.messages` already returns
  the current state. Changing what the same call returns would also break
  hosts with no error to show for it.
- **Leaving idle to the host** (2026-10-09): a host can derive it from
  `onSettled` with an empty queue plus `pending:dropped`, but a drop during
  the last settle and a drop just after it need opposite handling, and
  telling them apart means mirroring the scheduler's task state.
- **Running the settle step inside the operation's work closure**
  (2026-10-09): the first implementation. It needed an Agent-level
  `settling` flag beside the scheduler's own `settled` flag so that
  `cancel()` could answer, two booleans in two objects implying one
  lifecycle. Owning the phase in the scheduler removed both.
- **Firing only for operations that opened a turn** (2026-10-09): required
  a record the operation marks at `turn:user` and the scheduler's settle
  step reads, because a dropped send throws an error that does not say
  whether the turn opened. See above for why the rule itself was wrong once
  the hook carries the outcome.
- **A second outcome shape** (2026-10-09): status plus the agent turn, say.
  Hosts need the error object and the abort reason to tell a timeout from a
  user stop; the handle already settles with those, and `PromiseSettledResult`
  is the standard name for "what a promise settled with".
- **Awaiting callbacks in registration order** (2026-10-09): each callback
  is independent and none sees another's result; running them together is
  the simpler rule and the faster one.
- **Host-side pending lists** (2026-10-08): the status quo. A host mirrors
  state the Agent owns, with no event linking a `turn:user` to its send and
  no signal from `clear()`.
- **Pending entries inside `turns` with a `queued` status** (2026-10-08):
  ordering works, since the queue is FIFO, but a dropped entry must be
  removed (ending append-only) or kept as a tombstone; `turn:user` would no
  longer mean the message is in the conversation; and saved data would
  contain pending rows that exist in no Agent queue after restore.
- **Pending in `AgentSession`, restored into a "held" state** (2026-10-08):
  a queued send is more than its message — output schema, file resolver,
  abort signal, and the handle someone awaits do not survive serialization.
  An Agent that re-ran them on construction would start provider calls with
  no handle; one that held them would keep an entry pending forever when the
  host never acted.
- **`Transcript.snapshot()` that filters pending** (2026-10-08): redundant
  once pending lives outside `turns`, and a second way to save that hosts
  could confuse with the first.
- **Putting the session on the turn event stream** (2026-10-08): hosts
  forward turn events to clients; the model-facing conversation would ship
  to the browser on every turn.
- **A callback after every event** (2026-10-08): messages change only when
  an operation settles; mid-turn they would be identical to the last firing
  or hold a user message with no reply.
- **Letting `snapshot()` jump the queue** (2026-10-08): changes what it
  means for every host — `send(); send(); snapshot()` is expected to include
  both sends. Waiting for idle (2026-10-09) keeps that.
- **Letting an `onSettled` throw propagate, or rethrowing it outside the
  operation** (2026-10-08): propagating replaces the result of a send whose
  messages are already committed, so a caller that retries sends the message
  twice. Rethrowing as an uncaught exception takes the process down with
  work still queued. A host handles its own save failures in its callback.
- **`onSnapshot` as the name** (2026-10-08): the pair with `snapshot()`
  invites reading it as "fires when `snapshot()` is called". The callback is
  named for the moment, `onSettled`.

- **Keeping `History.turns` as an in-RAM convenience mirror** (2026-08-12):
  a mirror that is neither serialized nor authoritative recreates the
  neither-here-nor-there problem at smaller scale.
- **`AgentSession.version`** (2026-08-12): duplicates host-side versioning
  (hosts already version their stored blobs); an incompatible shape change
  is an ordinary breaking release. Unknown-key tolerance replaces it.
- **`archive` (append-only message log in the Agent)** (2026-08-12): no
  readers existed; the transcript is a strict superset for lookback; retention is
  a host choice at the compaction boundary.
- **Injected transcript (`new Agent(new Transcript(), …)`)** (2026-08-12):
  the engine only ever writes to it — that is a subscriber with extra
  ceremony, and it falsely implies the Agent owns the transcript's lifecycle.
  The event stream is the channel designed for this. Revisit only if turn
  commit must await durable writes (WAL semantics), which no consumer wants.
- **`agent.sessionUsage` meter** (2026-08-12): usage fails the continuation
  test (instance-lifetime, resets on restore) and hosts already receive
  per-turn usage on `turn:end`.
- **Turn retrieval/paging API on the Agent** (2026-08-11): deep-history
  readers are host-storage readers; messages already work this way.
- **Injected semantic-memory lifecycle** (2026-08-12): automatic recall and
  record mixed prompt augmentation, persistence, tool registration, and
  failure policy into the Agent. Tools and host-supplied `Instruct` context
  cover the actual behaviors without a memory-specific runtime contract.
- **`CompiledUserTurn` intermediate** (2026-08-12): paired an already-rendered
  message with a response parser, but split knowledge of rendering and parsing
  outside `Instruct`. `Instruct` now owns validation, message materialization,
  and response parsing directly; the Agent schedules one cloned instruction.
