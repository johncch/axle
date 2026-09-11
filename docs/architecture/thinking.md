# Thinking parts

**Status**: current · **Last design revision**: 2026-09-11 (0.32.0)

This document is normative for how model reasoning moves from a provider's
wire format to a transcript turn: which layer records what, which provider
source writes which field, and what the message layer must preserve so the
next request can continue the model's chain of thought. Code and tests are
built against it; divergence is a defect. The request-side control
(`reasoning.display`) is normative in [reasoning.md](reasoning.md).
Vocabulary is defined in [terminology.md](../terminology.md).

## Invariants

1. **Four layers, one translation each.** Provider events become adapter
   chunks; the step reader writes chunks to the message and emits stream
   events; the turn builder folds stream events into turn events; the
   transcript folds turn events into turn parts. Every thinking delta is
   written twice, to the message and to the turn, because the two serve
   different masters.
2. **The message part is the wire shape.** `ContentPartThinking` on an
   `AxleMessage` carries `text`, `summary`, `redacted`, `continuity`, and
   `providerMetadata`, and exists so the next request can echo what the
   provider needs. Nothing on it is a display decision. Its `text` is the
   provider's block content as sent, not a rendering of it.
3. **The turn part is the display shape.** `ThinkingPart` on a turn carries
   `summary`, `raw`, `continuity`, and `providerMetadata`. Each content
   field is named for what the provider handed back, never for what a
   renderer should do with it. There is no boolean and no disclosure enum:
   which field is populated is the whole fact.
4. **Neither field present is the withheld state.** It renders the same
   whether the cause was safety redaction, `display: "hidden"`, or a
   provider that never disclosed. The turn builder never initializes a
   content field to an empty string; a field exists only once a delta
   wrote it.
5. **`redacted` is a wire flag and lives only on the message.** It means the
   provider substituted an opaque payload for the content and wants that
   payload echoed on the next turn. It is set from Anthropic's
   `redacted_thinking` block and OpenRouter's `reasoning.encrypted` detail
   and from nothing else. A thinking block with empty text and a signature
   is not redacted; it is hidden, and it echoes as an ordinary block. No
   turn part, turn event, or stream event carries `redacted`.
6. **Summary and raw are separate buffers end to end.** Adapter chunks,
   stream events, turn events, and the step reader's accumulators are
   distinct for the two; nothing shared between them makes a result depend
   on arrival order. Stream `thinking:end` carries `summary?` and `raw?`
   flat, the part's content shape with an event type on it, each present
   only if a delta wrote it.
7. **Events name the field they grow.** `thinking:raw-delta` appends to
   `raw` and `thinking:summary-delta` appends to `summary`, on both the
   stream and turn vocabularies; adapter chunks are `thinking-raw-delta` and
   `thinking-summary-delta`. Part open and close use `thinking:start` /
   `thinking:end` on the stream and `part:start` / `part:end` on the turn.
8. **Continuity is round-tripped by the message, never by the turn.**
   `continuity` holds the provider's resume token (Anthropic `signature` or
   `redactedData`, OpenAI `encrypted`, Gemini `thoughtSignature`). The turn
   part carries a copy for inspection; requests are built from the message.

## Where fields get written

Every row is what the adapter emits and, through the step reader, where it
lands. The message columns are the echo payload; the turn columns are what a
reader may see.

| Source                                                  | Message `text` | Message `summary` | Message `redacted` | Turn `summary` | Turn `raw` |
| ------------------------------------------------------- | -------------- | ----------------- | ------------------ | -------------- | ---------- |
| Anthropic `thinking` block, `display: summarized`       |                | ✓                 |                    | ✓              |            |
| Anthropic `thinking` block, `display: omitted`          |                |                   |                    |                |            |
| Anthropic `redacted_thinking`                           |                |                   | ✓                  |                |            |
| OpenAI reasoning item, summary deltas                   |                | ✓                 |                    | ✓              |            |
| OpenAI reasoning item, no summary requested             |                |                   |                    |                |            |
| OpenAI `gpt-oss`, `reasoning_text.delta`                | ✓              |                   |                    |                | ✓          |
| Gemini `thought: true` parts                            |                | ✓                 |                    | ✓              |            |
| Chat Completions `reasoning.summary` detail             |                | ✓                 |                    | ✓              |            |
| Chat Completions `reasoning.text` detail                | ✓              |                   |                    |                | ✓          |
| Chat Completions bare `reasoning` / `reasoning_content` | ✓              |                   |                    |                | ✓          |
| Chat Completions `reasoning.encrypted` alone            |                |                   | ✓                  |                |            |

The Chat Completions rows map wire shape, not disclosure. OpenRouter
documents no mapping from upstream model to detail type, and a harness run
on 2026-09-11 (Claude Haiku 4.5 through OpenRouter, `reasoning_effort`
sent) delivered Claude's summary as the bare `reasoning` string with no
`reasoning_details` and no signature. That summary lands in `raw`, the
audit's benign case. Whether OpenRouter emits `reasoning_details` under its
unified `reasoning` request object is untested; that question belongs to
the chat-completions boundary work (AXL-59).

## What each provider echoes back

| Provider         | Block sent on the next turn                                   | Built from                                         |
| ---------------- | ------------------------------------------------------------- | -------------------------------------------------- |
| Anthropic        | `thinking: { thinking, signature }`                           | message `summary ?? text` + `continuity.signature` |
| Anthropic        | `redacted_thinking: { data }`                                 | `redacted` + `continuity.redactedData`             |
| OpenAI           | `reasoning: { id, summary[], content?[], encrypted_content }` | message `summary`, `text`, `continuity.encrypted`  |
| Gemini           | `thoughtSignature` on the following part                      | `providerMetadata.thoughtSignature`                |
| Chat Completions | nothing today                                                 | —                                                  |

Anthropic signs whatever it put in the block's `thinking` field. Under
`summarized` that is the summary, so the echo sends the summary; under
`omitted` it is the empty string, so the echo sends an empty `thinking`
with the signature, never a `redacted_thinking`.

## Design rationale (2026-09-11)

**Redacted is the norm; raw is the exception.** Every native provider
withholds the real chain of thought and returns a summary at best. Raw
reasoning reaches Axle only from open-weight models, through OpenAI's
`gpt-oss` and some Chat Completions endpoints. A design that treats
disclosure as the default models the world backwards, and a `redacted`
boolean on the display side was that design: it fired on a request setting
Axle chose, marked it identically to a safety block, and two independent
consumers both read it as "render nothing."

**Two types, two jobs.** The message part and the turn part were
field-for-field identical while serving different masters, which is why
`text` read like a display field when on the message it is a signed
payload. Keeping the message at the wire shape and renaming only the turn
side makes the difference visible in the types. The one place the two pull
against each other is Anthropic, whose block content is a summary: the
adapter labels it a summary so the turn is right, and the echo converter
reads the summary field so the wire is right.

**The rename carries the weight.** `summary ?? text` was a precedence rule
a consumer had to be told; `summary ?? raw` reads as what it does. With
`redacted` gone from the turn, the worst a consumer that gets it backwards
can do is show raw where a summary existed, a benign fallback rather than a
block that vanishes on settle.

**A summary is a body, not a headline.** What providers put in `summary`
runs to paragraphs. It is a condensed body, an alternative to raw text, and
a consumer never holds both for one block. Headline-and-body is a render
contract across every part type and the headline is host-owned. The single
exception is Anthropic's progress update under `display: "updates"`, the
one place a provider hands back a real headline; it arrives as a sibling
block describing the next action, not as a field on the reasoning block.
Not planned work; recorded so the option is on file.

## Rejected alternatives

- **A `disclosure` enum on the turn part** (2026-09-10): computable from
  which field is populated, so a second source of truth for a fact the
  fields already carry.
- **Keeping `redacted` on the turn with reconciled semantics across
  adapters** (2026-09-11): once the flag means "opaque payload to echo," it
  is a request-building fact with no rendering consequence. The turn has
  nothing to do with it, and the only two adapters that can set it
  truthfully already do.
- **Dropping `summary` from the message part** (2026-09-11): the message
  layer holds as close to the wire as possible, and OpenAI's reasoning item
  echoes its summary array. Both content fields stay; the doc comment on
  `text` was the defect.
- **Leaving Anthropic's block content in the raw buffer** (2026-09-11):
  would show every Claude summary as `raw` after the rename, the opposite
  of the audit's write table. The adapter change is one line and the echo
  converter reads the summary field.
- **A single `final` string on stream `thinking:end`** (2026-09-11): with
  two buffers it reported whichever wrote last. Dropping the value would
  leave the event non-self-describing for `stream()` callers; wrapping both
  fields under `final` would add a nesting level no other event has, since
  `thinking:start` carries its metadata flat. The fields go flat.
- **Keeping `thinking:delta` as the raw event name** (2026-09-11): a delta
  that grows a field called `raw` under an unqualified name is the same
  told-not-shown rule the part rename removes. 0.32.0 already breaks this
  surface.
