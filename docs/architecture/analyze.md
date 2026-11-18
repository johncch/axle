# Analyze: asking questions of a conversation

**Status**: current (@experimental API) · **Last design revision**: 2026-11-18 (0.37.0, AXL-101)

This document is normative for `analyze` and the functions that ship with
it: what they return, what each field means, and what they deliberately
leave out. Code and tests are built against it; divergence is a defect.
`Turn` and the events it is folded from are defined in
[agent-state.md](./agent-state.md); failure types and codes in
[errors.md](./errors.md).

Analyze is its own concept, separate from the `Agent`. An `Agent` produces
turns. Analyze reads turns, from any source and at any later time, and
helps a person or a program understand what the agent did. It has no
access to the agent, the provider or the event stream.

## Invariants

1. **The input is `Turn[]` and nothing else.** `analyze(turns)` is a pure
   function. Anything it reports is on the turns or computed from them. A
   fact that is not on `Turn` is added to `Turn` first, in the turn events,
   and never passed to `analyze` on the side.
2. **Everything returned is plain data.** `analyze` returns a plain object
   of plain arrays of plain objects. There are no classes, no methods and
   no subclass of `Array`. The JavaScript array methods are the query
   language.
3. **The vocabulary is exported predicates and functions.** A named filter
   is a function that takes one segment and returns a boolean, passed to
   `filter`, `some`, `every`, `find` or `findIndex`. Questions about order
   or totals are functions that take a list.
4. **A segment is one piece of the conversation**: a turn, a tool call, a
   subagent call, a compaction or a piece of text. Every list holds
   segments in the order they happened. `turns`, `tools`, `subagents`,
   `compactions` and `texts` each hold one segment type; `parts` and
   `errors` hold a mix.
5. **Segments carry no content, with one exception.** A segment says what
   happened and where. The text the agent wrote, a tool's result and a
   compaction's summary stay on the turns, and `partOf(turns, segment)`
   returns the original part. The exception is a tool or subagent call's
   `parameters`, which are kept because triage and `repeats` need them.
6. **The same list names work at every scope**: the whole conversation, one
   turn, and one subagent call.
7. **Subagents are sequestered.** A list at one scope describes that
   scope's own run only. What a subagent did is under its
   `SubagentCallSegment`. `flatten` folds the levels together for a reader
   that wants them merged.
8. **One object per thing.** A tool call reached through `a.tools`,
   through its turn's `parts`, through its turn's `tools` and, when it
   failed, through `a.errors` is the same object. There is no separate
   error type: an error is the segment that failed. Segments point at
   their turn by id, so there are no cycles.
9. **Analyze does not judge.** It reports structure. It has no notion of
   a "clean" or "degraded" conversation and never reads what the user or
   the model meant.

## Entry point

```ts
import { analyze, failed, named } from "@fifthrevision/axle/analyze";

const a = analyze(transcript.turns);
```

Everything in this document is exported from the `@fifthrevision/axle/analyze`
subpath and not from the package root.

`analyze` accepts turns that are still in progress. Their segments carry
the status the turn or part has at that moment, and the outcome predicates
are all false for them.

## Lists and scopes

| Scope                   | Lists                                                           |
| ----------------------- | --------------------------------------------------------------- |
| `analyze(turns)`        | `turns`, `tools`, `subagents`, `compactions`, `texts`, `errors` |
| a `TurnSegment`         | `parts`, `tools`, `subagents`, `compactions`, `texts`, `errors` |
| a `SubagentCallSegment` | `turns`, `tools`, `subagents`, `compactions`, `texts`, `errors` |

| List          | Holds                                                                                   |
| ------------- | --------------------------------------------------------------------------------------- |
| `turns`       | the user and agent turns of this run                                                    |
| `tools`       | tool calls: ordinary tools, deferred tools and provider tools                           |
| `subagents`   | subagent calls, each with the same lists for its own run                                |
| `compactions` | compaction attempts                                                                     |
| `texts`       | the pieces of text the agent wrote                                                      |
| `errors`      | every segment that failed: turns, tool calls, subagent calls and compactions            |
| `parts`       | the turn's tool calls, subagent calls, compactions and texts in the order they happened |

Thinking, citation and file parts produce no segment. Part segments
describe what the agent did, so a user turn's lists are empty.

A turn's `errors` is, in order: the turn itself when it failed, then its
failed tool calls, subagent calls and compactions. The top-level `errors`
is every turn's `errors` joined. A subagent call that failed is one segment
in its parent's `errors`; what went wrong inside it is in its own `errors`.

## Segments

```ts
interface Segment {
  turnId: string;
  partId?: string; // absent when the segment is the turn itself
  turnIndex: number; // position of the turn in its own run
  depth: number; // 0 for the conversation, 1 inside a subagent, …
}

interface SegmentError {
  type: string;
  message: string;
  code?: string;
}

interface TurnSegment extends Segment {
  kind: "turn";
  owner: "user" | "agent";
  status: "pending" | "streaming" | "complete" | "cancelled" | "error";
  reason?: "stop" | "length";
  cancelled?: "user" | "timeout";
  error?: SegmentError;
  recovered?: boolean;
  rescue?: boolean;
  tokens?: { in: number; out: number };
  start?: string;
  end?: string;
  ms?: number;
  parts: PartSegment[];
  tools: ToolCallSegment[];
  subagents: SubagentCallSegment[];
  compactions: CompactionSegment[];
  texts: TextSegment[];
  errors: FailedSegment[];
}

interface ToolCallSegment extends Segment {
  kind: "tool" | "deferred" | "provider";
  name: string;
  status: "pending" | "running" | "waiting" | "complete" | "cancelled" | "error";
  parameters: Record<string, unknown>;
  error?: SegmentError;
  recovered?: boolean;
  start?: string;
  end?: string;
  ms?: number;
}

interface SubagentCallSegment extends Segment {
  kind: "subagent";
  name: string;
  status: "pending" | "running" | "complete" | "cancelled" | "error";
  parameters: Record<string, unknown>;
  error?: SegmentError;
  recovered?: boolean;
  start?: string;
  end?: string;
  ms?: number;
  turns: TurnSegment[];
  tools: ToolCallSegment[];
  subagents: SubagentCallSegment[];
  compactions: CompactionSegment[];
  texts: TextSegment[];
  errors: FailedSegment[];
}

interface CompactionSegment extends Segment {
  kind: "compaction";
  trigger: "manual" | "beforeTurn" | "afterTurn";
  status: "pending" | "running" | "complete" | "cancelled" | "error";
  error?: SegmentError;
  recovered?: boolean;
  start?: string;
  end?: string;
  ms?: number;
}

interface TextSegment extends Segment {
  kind: "text";
  chars: number;
}

type PartSegment = ToolCallSegment | SubagentCallSegment | CompactionSegment | TextSegment;

type FailedSegment = TurnSegment | ToolCallSegment | SubagentCallSegment | CompactionSegment;
```

Every segment that can fail has `kind`, `status`, `error` and `recovered`
with the same meaning, so the mixed `errors` list reads without narrowing:

```ts
a.errors.map((e) => e.error?.message);
a.errors.filter((e) => !e.recovered);
a.errors.filter((e) => e.kind === "tool").map((e) => e.name);
```

Field meanings that are not obvious from the name:

- **`error`**: present exactly when `status` is `"error"`.
- **`error.type`**: on a turn, the turn failure's kind (`api`,
  `incomplete`, `refusal`, `parse`), or `thrown` when the turn ended on a
  thrown error that was not the provider's answer. On a tool or subagent
  call, the tool error type (`execution`, `validation`, `fatal`, …), which
  is an open string because provider tools pass their own. On a
  compaction, `"compaction"`. It is `unknown`, with an empty message, when
  the turn or part recorded no error, as turns stored before 0.37 can.
- **`error.code`**: an `AxleErrorCode`, present only when Axle threw the
  error. Tools and compactors never set one.
- **`recovered`**: present exactly when `status` is `"error"`. `true` when
  the turn the failure happened in went on to complete. On a turn it is
  always `false`.
- **`cancelled`**: present exactly when `status` is `"cancelled"`.
  `"timeout"` when the turn timeout cancelled it, `"user"` otherwise.
- **`rescue`**: present on every user turn. `true` when the turn before it
  is an agent turn with status `"error"`. It is positional. A user turn
  that follows a cancelled turn is not a rescue.
- **`tokens`**: the turn's usage, which already includes its subagents'
  usage. Adding a subagent's own turns to its parent's double counts.
- **`parameters`**: the same object the turn holds, not a copy.
- **`start`, `end`, `ms`**: from the turn's or part's timing, absent when
  it has none.

## Predicates

| Predicate     | True when                  |
| ------------- | -------------------------- |
| `failed`      | `status` is `"error"`      |
| `completed`   | `status` is `"complete"`   |
| `cancelled`   | `status` is `"cancelled"`  |
| `byUser`      | `owner` is `"user"`        |
| `byAgent`     | `owner` is `"agent"`       |
| `named(name)` | `name` equals the argument |

Each returns `false` for a segment that lacks the field it reads, so they
are safe on the mixed `parts` and `errors` lists.

```ts
a.tools.filter(failed);
a.tools.some(named("read-file"));
a.turns.filter(byAgent).filter(completed);
turn.parts.findIndex(failed);
```

`a.errors` equals every segment for which `failed` is true, in order.

## Functions

| Function                   | Returns                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `streaks(list, predicate)` | Runs of two or more consecutive segments that match, as an array of arrays          |
| `repeats(list)`            | Groups of two or more segments that are the same event repeated (see below)         |
| `sum(list, pick)`          | The total of `pick(segment)` over the list, treating `undefined` as 0               |
| `flatten(a)`               | The same six lists with every subagent level folded in                              |
| `partOf(turns, segment)`   | The original `Turn` for a `TurnSegment`, or the original part for any other segment |
| `simplify(turns, opts?)`   | The turns with only their content, for a person or a model to read (see below)      |

`repeats` treats two tool or subagent calls as the same when their name,
parameters and error type are equal, so a call that failed and then
succeeded is not a repeat. It treats two failed turns or two failed
compactions as the same when their error type and message are equal.
Segments that did not fail and are not calls are never grouped.

`flatten` keeps `turns` as the top-level turns only, so sums of `tokens`
and `ms` over it stay correct. In the other five lists a subagent's
segments follow the subagent call that produced them. Segments are the
same objects and are told apart by `depth`.

`partOf` searches subagent runs as well, so it works on a segment of any
depth.

## Simplify

`analyze` is content-free. `simplify` is the one function that carries
content: it removes everything from the turns that is not content (ids,
timing, usage, annotations, metadata) and cuts long strings short, so the
result fits in a prompt or on a screen. Its readers are a person or a
model judging what the agent said and did.

```ts
simplify(turns, { maxChars: 800 });
```

```ts
interface SimplifiedTurn {
  owner: "user" | "agent";
  status: "pending" | "streaming" | "complete" | "cancelled" | "error";
  error?: { type: string; message: string };
  parts: SimplifiedPart[];
}

type SimplifiedPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "file"; name: string }
  | {
      type: "tool";
      name: string;
      parameters: unknown;
      result?: unknown;
      error?: { type: string; message: string };
    }
  | {
      type: "subagent";
      name: string;
      parameters: unknown;
      result?: unknown;
      error?: { type: string; message: string };
      turns: SimplifiedTurn[];
    }
  | { type: "compaction"; summary?: string; error?: string };
```

- Every string longer than `maxChars` (default 800) is cut to that length
  and ends with `…`. This applies at any depth inside `parameters` and
  `result`.
- Ids, timing, usage, annotations and metadata are dropped.
- A thinking part shows its summary, or its raw text when there is no
  summary. A thinking part with nothing to show is left out.
- A tool part is an ordinary, deferred or provider tool call. `result` is
  present when the call succeeded with content, `error` when it failed.
- Citation parts are dropped. A file part keeps its name only.
- The input turns are not changed: `parameters` and `result` are copied.
- `maxChars: Infinity` cuts nothing. A negative or non-numeric `maxChars`
  throws `INVALID_OPTIONS`.
- A turn with no parts left is kept when it failed or was cancelled, and
  dropped otherwise.

## What analyze reads from `Turn`

`analyze` depends on facts that `Turn` gains in the same release. They are
defined in the documents that own them:

- Whether a cancelled turn was cancelled by the user or by the turn
  timeout ([agent-state.md](./agent-state.md)).
- The error a turn ended on when it threw one that was not the provider's
  answer, with its code when Axle threw it ([errors.md](./errors.md)).
- A failure to list MCP tools is an error turn that keeps the user
  message, where it used to leave no turn ([agent-state.md](./agent-state.md)).
- A failed subagent's error message no longer embeds the child's failure
  as JSON ([errors.md](./errors.md)).

What `analyze` cannot see, because no turn records it: a queued send that
was cancelled before it started, a start refused by a throwing `onStart`,
errors that reject before any turn opens (`INVALID_OPTIONS` and similar),
and retries made inside a provider SDK.

## Design rationale (2026-11-18)

**Why read turns and not events.** Hosts that render or resume already
keep `Transcript.turns`. Reading them works on conversations that ended
long ago, needs no extra wiring, and keeps one fold of the events. A second
fold can disagree with the first: the earlier `Incidents` sink recorded a
concurrent tool batch in the order calls settled while the transcript kept
the order the model asked for them.

**Why plain data and predicates.** JavaScript libraries that started as
wrappers with methods (moment, lodash's chain) moved to plain data with
pure functions (date-fns, lodash-es, d3-array, the `unist-util-*`
packages). Plain data survives JSON, a worker boundary and a database
insert. A predicate is named once and serves five array methods, where a
collection method serves one. The cost is discovery: a reader finds
`failed` through the import list, and not by typing a dot after `a.tools`.

**Why segments differ from `Turn`.** The goal is to make analysis easy,
and not to keep one canonical structure. `Turn` is shaped for rendering.
Segments are shaped for counting, grouping and storing, so the same
segment is reachable from several lists (a failed tool call is in `tools`,
in `errors` and in its turn's `parts`) and what `Turn` nests is flat
(`detail.name` becomes `name`).

**Why an error is the segment that failed.** A separate error type
repeated the failed segment's fields and needed a link back to it. With
`errors` holding the failed segments, a reader who narrows by `kind` has
the whole call, parameters included, and `errors` cannot disagree with
`filter(failed)`.

**Why subagents are sequestered.** Merging lists is one function call.
Separating a merged list needs a filter on every question, and the common
question is about the conversation itself.

**Why `recovered` and `rescue` are structural.** Both can be computed
without reading content, so they are deterministic and cheap. Whether a
user turn was meant as a retry, or whether a later success was the same
request, needs meaning that only the host or a model can supply.

## Rejected alternatives

All dated 2026-11-18 unless noted.

- **An `Incidents` sink on the event stream** (2026-11-02, AXL-91). Its
  kinds were the events it read and not the questions a host asks, it only
  knew about errors, and it was a second fold of the events.
- **A `Digest`: a versioned, content-free record with a `summary` block.**
  Most of what it held could be read from turns directly, and the summary
  was a fixed set of counts where hosts want their own. It was a stored
  format looking for a consumer.
- **One uniform row type from `flatten(turns)`**, as in distributed
  tracing. One traversal and one type, but every question that spans a
  part and its turn needs a lookup by id, and the union is sparse.
- **A collection object with chained getters** (`a.tools.failed.count`).
  It reads well, but it needs either a wrapper class or a subclass of
  `Array`, and the chain grows without limit (`recovered`, `unique`,
  `first`).
- **`has(a.tools, "read-file")`.** `a.tools.some(named("read-file"))`
  says the same and `named` also works with `filter` and `find`.
- **A `deep` property holding the merged view.** A function, `flatten(a)`,
  does the same without a second copy of the vocabulary on every result.
- **Merging subagent turns into the input before analyzing.** It puts
  subagent turns into the conversation, which breaks the turn count and
  `rescue`.
- **A `requests` list**, one entry per provider request. It is
  `turns.flatMap((t) => t.usage.breakdown)`, and a turn's rows include its
  subagents' requests, so it cannot be sequestered.
- **A `thoughts` list.** Nothing asks for it.
- **Text on `TextSegment`.** Analysis rarely reads content, and when it does
  the turns are the place for it.
- **A separate error type in `errors`** (`{ kind, type, message, name,
recovered }` plus a location). It duplicated the failed segment and hid
  its parameters behind a lookup.
- **Reporting compactor token usage.** Usage counts the agent's work on
  the task, and the compactor is not the task.
- **New error codes for compaction or MCP listing failures.** A code is
  useful only where Axle decides it from something Axle observed and the
  caller's next move differs. Tools and compactors are host APIs.
