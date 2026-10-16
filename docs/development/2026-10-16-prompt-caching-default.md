# Prompt caching on by default (0.34.1)

Working note for the hotfix that made Axle ask Anthropic and OpenRouter to
cache the prompt prefix on every request. Normative text is in
`docs/architecture/provider-content.md`, section "Prompt caching".

## Starting point

Another agent reported that Axle never enabled caching on Anthropic
requests. It was right. The Anthropic builder assembled model, max_tokens,
messages, system, tools, thinking and tool_choice, then spread
`providerOptions`, and nothing anywhere added `cache_control`. The
streaming adapter had mapped `cache_creation_input_tokens` and
`cache_read_input_tokens` into `cacheWriteIn` and `cachedIn` since the
usage work, so the telemetry existed and read zero on every Anthropic run.
The only code that ever sent the field was the `cache-prompt-reuse` check,
which passed it through `providerOptions` for Anthropic alone.

No doc, note or comment recorded a decision against caching. It was an
omission: the provider was written without the flag, and the usage mapping
was added later for reporting, so nothing forced the question.

Scope of the damage, established before touching code:

- OpenAI caches automatically above 1,024 tokens, Gemini 2.5 and later has
  implicit caching on by default, and Together caches automatically on
  serverless and dedicated inference. Those providers had been getting
  reads all along.
- Anthropic requires an explicit marker, so every `Agent` loop on Anthropic
  re-billed the whole conversation at full input price on every step.
- OpenRouter is a pass-through: it needs the same marker for Claude and
  Qwen upstreams and nothing for the rest. Claude through OpenRouter was
  therefore uncached as well.

## The design conversation

The first question was whether a knob belonged at the portable request
level. The intuition was `cache: true` by default and `false` to turn off,
with a worry that normalization would be messy and that providers might
reject a field they do not know.

The rejection worry resolved per provider. Anthropic documents the
top-level automatic field. OpenAI returns a 400 for an unknown parameter.
Gemini has no field and an unknown config key fails. OpenRouter documents
the top-level field for Claude hosts and was silent on other models.
Together is silent. So the field had to be per provider, never blind.

The normalization worry resolved by changing what the knob means. "Caching
on or off" cannot be honored: OpenAI, Gemini and Together cache whether
asked or not and offer no off switch. Defined instead as "whether Axle asks
for caching where asking is required", `true` makes Anthropic and
OpenRouter requests carry the top-level field, `false` omits it, and the
three automatic providers ignore both. No provider receives a field it
does not understand, and there is no per-model table to maintain, which is
the failure mode the reasoning `off` knob ran into.

One fact was unknown and settled live rather than guessed: whether
OpenRouter rejects the field for a non-Claude model. One request to
`deepseek/deepseek-v4.1-flash` with the field present returned 200 with
zero cache counters. OpenRouter owns the field and drops it where the
upstream caches on its own, so the emit is vendor-wide rather than gated
on the `anthropic/` namespace.

## Decision

- `cache?: boolean` on `AxleModelRequestOptions`, default `true`, so it
  reaches `Agent`, `stream()`, `generate()`, agent definitions and the CLI
  `request:` block through the existing plumbing.
- The Anthropic builder emits `cache_control: { type: "ephemeral" }` unless
  `cache === false`, placed before the `providerOptions` spread so a host's
  explicit value, including a 1-hour TTL, replaces it.
- The chat completions builder emits the same for the `openrouter` vendor,
  next to `session_id`. Both live in `toOpenRouterRequestFields` in the
  vendor module, reached through one dispatch in utils, so the builder has
  no inline vendor conditions.
- The 5-minute TTL only. Reads refresh the entry, so a running loop never
  lets it expire; the 1-hour write costs 2x instead of 1.25x and pays off
  only for 5 to 60 minute idle gaps, which is a host decision made through
  `providerOptions`.

## The OpenRouter session finding

The Anthropic check passed on the first run with the default on: the first
call wrote 10,032 tokens and the second read 10,032. The same check
through OpenRouter on `anthropic/claude-haiku-4-5` failed: both calls
wrote 10,031 and read 0. OpenRouter routes by `session_id`, and without
one the two requests reached different Claude hosts, each with its own
cache. With a `sessionId` on the check, the second call read 10,030.

That exposed a gap in `stream()` and `generate()`. Both run a tool loop
where every step shares a growing prefix, and only `Agent` sent a session
id. A bare call to OpenRouter with a Claude model could place the
breakpoint on every step and never hit. The fix is in `stream()`, not the
builder: the builder runs once per step and would mint a new id each time,
which is the no-hit case. `stream()` resolves the id once per call, the
caller's or a fresh UUID, and sends it on every step; `generate()`
inherits it; `Agent` is unchanged. A `generate()` tool loop through
OpenRouter with a 10K-token prefix and no session id then wrote 12,599 on
step one and on step two read 12,599 and wrote the 62 tokens the tool
round added.

Two separate bare calls still get two ids. Without a caller-supplied id
there is no way to know they are one conversation, and the README says to
pass `sessionId` for hits across calls.

## Rejected

- **Off by default, opt in through `providerOptions`.** The prior state.
  A one-shot prompt saves a 25% write premium; a loop, which is what
  `Agent` exists for, loses 90% of its input cost. The default follows the
  loop.
- **A knob meaning "caching on or off".** Cannot be honored on three of
  five providers. See above.
- **Gating the OpenRouter emit on `anthropic/` models.** Observed
  unnecessary, and a model-prefix list would need updating whenever
  OpenRouter adds an upstream that wants explicit markers, failing silently
  in exactly the way this bug failed.
- **Minting a session id in the chat completions builder.** Per step, so
  useless; the id must be per call.
- **Per-block breakpoints or a 1-hour default.** Placement and TTL are host
  decisions; both stay on `providerOptions`.
- **Removing `cache` from `AgentConfig`.** It would need a type carve-out
  for one flag, and a host on a gateway that rejects the field has a real
  use for it.

## Also landed

- Together reports the hit count under `prompt_tokens_details.cached_tokens`
  on reasoning models and as a top-level `usage.cached_tokens` on some
  others; the usage mapping read only the nested shape and would show zero
  on a hit. It now reads both. Unit tested, not run live.
- The `cache-prompt-reuse` check no longer passes `cache_control` for
  Anthropic, so it proves the default, and it sends a `sessionId` so the
  OpenRouter variant routes both calls to one host.

## Costs, accepted

- A one-shot Anthropic prompt that is never repeated now pays the 1.25x
  write on its cacheable part with no read. `cache: false` is the opt-out.
- Each bare `stream()` or `generate()` call to OpenRouter appears as its
  own one-request session in the OpenRouter dashboard instead of being
  ungrouped.
- `cache: false` alongside an explicit `providerOptions.cache_control`
  sends the explicit one. The raw channel wins, as everywhere else.

## Verification

Live, 2026-10-16: Anthropic `claude-haiku-4-5` two calls (write then
read); OpenRouter `anthropic/claude-haiku-4-5` two calls without session
(write, write), with session (write, read), and one two-step tool loop
without a caller session (write, then read plus a 62-token write);
OpenRouter `deepseek/deepseek-v4.1-flash` one call with the field (200,
ignored). Unit tests cover the default, the opt-out, the `providerOptions`
override, the vendor gating, the per-call session id across loop steps,
and both Together usage shapes.
