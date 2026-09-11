# Thinking Display

Working note for AXL-56, "Normalize thinking summaries across providers"
(0.32.0). The normative result lives in `docs/architecture/reasoning.md`
(invariants 10 and 11, the display table, and the dated rejected
alternatives); this records how the design got there.

## Starting point

The thinking-part audit found that Axle never sends `display` on Anthropic
thinking requests. Every current Claude model defaults it to `omitted`, and
under `omitted` the server skips streaming thinking tokens entirely, so no
`thinking_delta` events reach any consumer. The ticket opened as
"send `display: "summarized"`" with one open question: fixed value, or a
caller-facing option alongside `ReasoningSetting`?

## What the survey showed

Laying out every route against the three controls Axle already had two of:

| Route             | On/off                   | Effort                 | Disclosure                                       |
| ----------------- | ------------------------ | ---------------------- | ------------------------------------------------ |
| Anthropic         | `thinking.type`          | `output_config.effort` | `thinking.display: summarized \| omitted`        |
| Gemini            | `thinkingBudget: 0`      | `thinkingLevel`        | `includeThoughts: boolean`                       |
| OpenAI Responses  | `reasoning.effort: none` | `reasoning.effort`     | `reasoning.summary: auto \| concise \| detailed` |
| OpenRouter        | `reasoning_effort: none` | `reasoning_effort`     | `reasoning.exclude: boolean` (inverse)           |
| Generic, Together | vendor shapes            | `reasoning_effort`     | none                                             |

Three things fell out of the table.

1. Disclosure is a separate request field on every native provider,
   orthogonal to on/off and effort. It cannot fold into either.
2. Provider defaults disagree: Gemini and OpenAI default to no summary,
   current Anthropic to `omitted`, legacy Anthropic to `summarized`. Axle
   already overrode Gemini's default (`includeThoughts: true` on every
   enable) while inheriting the other two. OpenAI had the same defect as
   Anthropic, one provider over, and the audit's own write table listed it.
3. The knob is binary on four routes out of five. Only OpenAI has levels.

So the change grew from "send a fixed Anthropic value" to "make disclosure
the third portable knob, and land it on Anthropic and OpenAI in the same
diff so the invariant is written once."

## Why `default` stays silent

`display` lives inside `thinking`, and `thinking` needs a `type`. There is
no way to say "keep your default mode but summarize it." Any `type` chosen
under `"default"` is wrong for some generation: `adaptive` turns thinking on
for Opus 4.7/4.8 and returns 400 on Haiku 4.5; `enabled` needs a budget and
returns 400 on Opus 4.7 and later. Gating it per model would be the
capability registry the doc rejected on 2026-09-07. So `"default"` on Opus 5
still returns invisible thinking, and a caller who wants to see it says
`reasoning: "on"`. That is the same deal Gemini callers already had.

This is also why `display` is a sub-field of the effort object rather than a
sibling option: Gemini and OpenAI could send the flag alone, Anthropic
cannot, and nesting makes "display without an enable" unrepresentable on
every route instead of documented for one.

## Subset, not superset

The tempting shape was `summary: "off" | "concise" | "detailed"`, mapping
both levels to `true` on Gemini and Anthropic. The doc had already rejected
exactly this pattern for Together `enabled`-only: an explicit value dropped
silently. Effort took the subset route for the same reason (`xhigh`, `max`,
`minimal` stay in `providerOptions`), and the disclosure intersection is
smaller still: yes or no. OpenAI's `auto` is the honest "yes," since it is
the provider's own "give me a summary, you pick the length," not one of two
levels with the other discarded.

## Naming: the morning's real wrestle

Three names were tried in order.

- `summary: boolean`. Rejected because `reasoning` itself had just been
  migrated off a boolean in 0.31, and because Anthropic's `updates` beta
  (progress notes only, reasoning hidden) is a genuine third state on this
  axis that a boolean cannot hold.
- `summary: "on" | "off"`. Read as a toggle for a thing that felt more like
  a level, and `"on"` names nothing on the response side.
- `display: "summary" | "none"`. Attractive because AXL-58 renames the part
  fields to `summary` and `raw`, so request and response would share words.
  Rejected once the coherence question was asked directly: Axle will show
  both summaries and raw text, and no provider lets the caller choose which.
  An open-weight model answers a `"summary"` request with raw text, so the
  value promises what the request cannot deliver.

The split that made it coherent: the request controls disclosure, the part
records form. `display: "visible" | "hidden"` names only what the caller
controls. `summary` and `raw` on the part name only what arrived. The two
can legitimately disagree, and that gap is what the part fields are for.
This does not conflict with AXL-58's rejection of a `disclosure` enum on the
part: that rejection is about a derived fact duplicating the fields; the
request knob is an input.

## OpenRouter

OpenRouter's only disclosure control is `reasoning.exclude`. It strips
reasoning from the response and never selects a form; OpenRouter itself
picks `summarized` for Claude upstream. Axle sends `reasoning_effort` on
that route rather than the `reasoning` object, so `"hidden"` adds
`reasoning: { exclude: true }` beside it through a vendor branch next to
Together's. Generic endpoints and Together have no field and stay no-ops,
which is the same footing effort already stands on for models that ignore
`reasoning_effort`.

## What this does not fix

`isRedacted` in the Anthropic streaming adapter still fires on
`display: "hidden"` (empty text plus a signature) and marks it identically
to a `redacted_thinking` safety block, while the same request on Gemini
yields `redacted: false`. That is AXL-57. This change removes the common
case from its scope, since normal Anthropic blocks now carry text, but
leaves the flag's semantics untouched.

## Verification

Unit tests cover the resolver, every route's visible and hidden mapping,
and the OpenRouter exclude branch. The `reasoning-efforts` harness case now
fails on Anthropic, OpenAI, and Gemini targets when no effort returns
thinking text. OpenAI summaries have historically been gated on
organization verification; if the harness shows a rejection there, OpenAI
splits back out into its own ticket.
