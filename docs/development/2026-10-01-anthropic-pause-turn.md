# Anthropic `pause_turn` Continuation

Working note for AXL-50, "Automatically continue Anthropic pause_turn
responses" (0.33.0). There is no architecture doc for provider tools yet;
this note is the record of the decisions.

## Starting point

When Claude uses a tool that Anthropic runs itself (web search, web fetch,
code execution), a long turn can come back unfinished with
`stop_reason: "pause_turn"`. The caller is expected to send the conversation
back so the turn can continue. Axle mapped `pause_turn` to
`AxleStopReason.Error`, and the loop in `stream()` treats anything other
than a client tool call as final, so a paused turn was returned as
`ok: true` with a partial answer.

The ticket was written when `generate()` and `stream()` were separate loops
and assumed the continuation would live in both. Since #32 `generate()` is
`stream().final`, so there was one loop to consider.

## What Anthropic requires

Researched 2026-10-01 from the server tools page.

| Requirement                                                                 | What Axle sends                                                            |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Continue by passing the paused response back as-is                          | The blocks as received, appended as one assistant message                  |
| No user message and no tool result in the continuation                      | Nothing is added after the assistant message                               |
| Same tools; a missing tool is a validation error                            | The first request's body, with only `messages` changed                     |
| A continued turn can pause again                                            | Repeats until another stop reason arrives                                  |
| A pause can end on a `server_tool_use` whose result is in the next response | One adapter reads every response of the turn, so the result finds its call |
| A pause never leaves a client `tool_use` waiting                            | A continuation that ends in `tool_use` goes to the normal tool loop        |

The docs show only a single continuation. After a second pause Axle sends
all paused content so far as one assistant message; that shape is a reading
of the docs, not something observed against the live API.

## Decision: continue inside the Anthropic adapter

The ticket described the pause as a loop-level condition with its own finish
reason. We put it in `createStreamingRequest` instead: when a response ends
with `pause_turn` the adapter sends the next request and keeps yielding
chunks, so `stream()` sees one long response.

Reasons:

- The adapter still holds Anthropic's blocks exactly as they arrived, so the
  continuation does not depend on how Axle stores messages.
- A search requested in one response and answered in the next is matched by
  the same adapter instance. In the loop, each response would have been its
  own step with its own adapter, and the result would have been dropped.
- The shared loop, the turn builder, and `Agent` are untouched, and
  `AxleStopReason` gains no member that only one provider can produce.

Costs, accepted:

- `maxSteps` does not count continuations. The ticket asked for each request
  to count; a paused turn is one step however many requests it takes.
- The step's usage is the sum over its requests. That is right for billing,
  but `maxContextTokens` compares it against the context budget, so a paused
  turn looks larger than its final request was.

`docs/terminology.md` defined a step as one provider request and now records
this exception.

## Decision: no continuation cap

The ticket asked for a finite default cap, and Anthropic's docs suggest one.
We left it out: a run of pauses is not different in kind from a long chain of
tool calls, which Axle also leaves unbounded unless the caller sets
`maxSteps`. Cancellation still stops it; the adapter checks the signal before
each follow-up request.

With no cap and the continuation inside the adapter, nothing can stop a turn
mid-pause except cancellation. That removed the one case where `Agent` would
have needed to know about pauses: a limit tripping with a search still
pending, followed by a `send()` that appends a user message after it.

## Decision: store what Anthropic sent on the provider-tool part

Replay in later turns was lossy in ways the pause work exposed:

- `input` was never set, because the adapter only buffered `input_json_delta`
  for client tool calls. Replay sent `input: {}`.
- Only `web_search_tool_result` was recognized, and replay rebuilt every
  result as that type from its inner `content`.

`ContentPartProviderTool` keeps its shape. On Anthropic, `input` is now the
parsed tool input and `output` is the whole result block, which is sent back
unchanged. This is what the OpenAI adapter already does with its single
search item. Because the block carries its own `type`, results from other
Anthropic-run tools pass through without Axle knowing them.

The input reaches the step reader through a new internal chunk,
`provider-tool-input`, emitted when the `server_tool_use` block closes. It
cannot ride on `provider-tool-complete`, because a call can finish its step
with no result. It is not a `StreamEvent`; consumers read `input` from the
message part.

This is breaking for anyone reading Anthropic `output`; see
`docs/0.33.0-migration.md`.

## Verification

Covered with scripted responses in
`packages/axle/tests/ai/anthropic/pause-turn.test.ts`, at the adapter and
through `stream()` and `generate()`. There is no `checks/` scenario: a live
pause cannot be triggered on demand, so nothing here has run against the
real API.

## Not done

Left for AXL-51 or later:

- Text citations (including web search `encrypted_index`) are not sent back
  in later turns.
- `caller` on `server_tool_use` is not stored.
- Blocks of a type Axle has no part for are dropped from the stored message.
  They are kept within a paused turn, where the raw blocks are replayed.
- A server tool called alongside a client tool has its result deferred to the
  next step's response, where a new adapter drops it.
- The response's `container` is neither stored nor sent.
