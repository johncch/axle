# OpenRouter Sessions

Working note for AXL-69, "Agent supports OpenRouter sessions" (0.33.0).

## Starting point

OpenRouter takes a top-level `session_id` on a Chat Completions request.
Researched 2026-10-02 from the chat completion reference, the prompt caching
guide, and the sticky routing tutorial:

| Requirement                                                                           | What Axle sends                                         |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| A string of at most 256 characters, in the body or an `x-session-id` header           | The body field, unchecked                               |
| Stable for the unit of work (a chat thread, a workflow run); never a new one per turn | The `Agent`'s `sessionId`, which snapshot/restore keeps |
| Body wins over the header when both are present                                       | Only the body                                           |

With it, OpenRouter uses the value as its sticky-routing key: every request
in the session goes to the same provider and, for router models, the same
resolved model, from the first successful request. Without it, stickiness is
derived from a hash of the opening messages and only starts after a cache
hit is observed. OpenRouter also groups the requests under the id in its
dashboard.

Axle's `Agent` already owned a `sessionId`, but nothing carried it to a
provider. Sunnyday had been sending `providerOptions: { session_id }` itself,
with its own run id or assistant key, which is why this never needed to land
in Axle before.

## Decision: a `sessionId` on `StreamParams`, filled by `Agent`

`sessionId?: string` is a field on `StreamParams` (so on `stream()` and
`generate()`) and on `ProviderStreamParams`. `Agent.send()` passes its own id.
The chat-completions builder emits `session_id` for the `openrouter` vendor
only; every other adapter ignores the field.

Reasons:

- Axle's session and OpenRouter's are the same unit: the continuable
  identity of one conversation. Compaction and resume keep the id, which is
  what OpenRouter asks for; batch items and subagents each have their own
  `Agent`, so each gets its own OpenRouter session.
- It stays off `AxleModelRequestOptions`, so it cannot be set per `send()`
  or in a definition's `request` block. The agent's id and the wire id can
  never disagree.
- `providerOptions.session_id` still wins because raw options are spread
  last. A host whose grouping key is not the agent's id (Sunnyday's assistant
  key) keeps that override and loses nothing.

Rejected: having `Agent` inject `providerOptions.session_id`. `Agent` does
not know the vendor, and `providerOptions` is the caller's channel for raw
overrides, not a place for Axle to smuggle its own state.

Costs, accepted:

- A host-chosen `sessionId` now reaches OpenRouter and is visible in its
  dashboard. The id is the host's own choice and the account is the host's;
  the README says so.
- An id over 256 characters is sent as-is and rejected by OpenRouter through
  the ordinary error path, in line with the reasoning doc's "no capability
  validation" invariant.
- Compaction's own request (`PromptCompactor`) does not carry the id; it is
  built by the host with its own `generate()` call.

## Verification

Unit tests only: request-body assertions in
`packages/axle/tests/providers/chatcompletions/createStreamingRequest.test.ts`
and an `Agent` test that the id reaches the provider across a snapshot and
restore. Nothing here has run against the live API; stickiness is not
observable from a single client.
