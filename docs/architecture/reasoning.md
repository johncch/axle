# Reasoning controls

**Status**: current · **Last design revision**: 2026-11-17 (0.37.0, the setting names a model's own knobs)

This document is normative for Axle's portable reasoning control: what the
`reasoning` request option means, how each provider adapter translates it,
and which model generations take which request syntax. Code and tests are
built against it; divergence is a defect. The provider requirements section
records what the providers demanded on the research date so the translation
can be re-checked when they change.

## Invariants

1. **One setting, shaped like the knobs models have.**
   `reasoning?: ReasoningSetting` where
   `ReasoningSetting = "default" | { enabled?: boolean; effort?: ReasoningEffort; display?: "visible" | "hidden" }`
   and
   `ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max"`.
   `enabled` is a model's on/off switch and `effort` its depth. A model may
   have either, both or neither, and they are separate fields because they
   are separate controls on the wire. `{ enabled: true, effort }` is the
   same request as `{ effort }`. An object that sets neither, or sets
   `enabled: false` beside an effort, is rejected with `INVALID_OPTIONS`.
   `"default"` is the only string: there is no bare effort, no `"on"` or
   `"off"`, and no boolean in place of the object. It is the same option
   on `Agent`, `generate()`, `stream()` and `PromptCompactor`; the CLI's
   `request` block has its own words for it (cli.md).
2. **`"default"` and omission send nothing.** No reasoning field reaches the
   wire on any route; the model runs at its provider's own default, which may
   be thinking-on (Sonnet 5, Opus 5, Fable, Gemini 2.5 Pro) or thinking-off
   (Opus 4.6–4.8, Haiku 4.5). Axle does not resolve or report which.
   `"default"` exists as a value so a per-send override can reset an
   Agent-level setting in words. It is the setting to prefer: every other
   one names a knob, and the caller is expected to know the model has it.
3. **Each knob is sent as the provider spells it; Axle maps none to
   another.** The six efforts (`REASONING_EFFORTS`, lowest first) are the
   union of the names Anthropic, OpenAI and Gemini use, and on a
   named-effort route an effort reaches the wire unchanged. `enabled: true`
   on its own is the provider's own switch: `reasoning.enabled` on Together
   AI and OpenRouter, `thinking.type: adaptive` on Anthropic, and
   `thinkingLevel: high` for the Gemma models Google documents that way.
   Where a provider has no switch without a depth (OpenAI Responses,
   generic Chat Completions, Gemini's level models, every budget-only
   model) there is no field to send, and Axle rejects with
   `INVALID_OPTIONS`; sending nothing would look like success while the
   model ran at its default. Which shape a knob takes is each adapter's
   to decide. No knob is portable across models. A host with an on/off
   control asks the catalog what to send (see
   [Choosing a setting](#choosing-a-setting)). An enable does not promise a
   visible thinking block or thinking on every adaptive-model response.
   (2026-11-17, AXL-106)
4. **`{ enabled: false }` sends the provider's explicit disable shape.**
   Never a low effort of Axle's choosing and never omission. For Gemma on
   Gemini the disable is `thinkingLevel: minimal`, because that is how
   Google spells off for those models. Models that cannot disable thinking
   reject the request and the provider error surfaces unchanged.
5. **Effort is relative within a model.** Low/medium/high are not comparable
   compute, latency, or token spend across models or providers.
6. **Route selection is a bounded ID set, not a pattern.** Each adapter that
   has two request syntaxes owns an explicit, lowercased set of the model IDs
   that take the legacy token-budget syntax
   (`ANTHROPIC_THINKING_BUDGET_MODELS`, `GEMINI_THINKING_BUDGET_MODELS`).
   Everything else, including aliases such as `gemini-flash-lite-latest` and
   IDs Axle has never seen, takes the modern named-effort syntax. No regex,
   no family/version parsing. The Gemini models whose switch is spelled as
   two levels are a set of the same kind (`GEMINI_THINKING_TOGGLE_MODELS`).
7. **Legacy presets are fixed, one per level.** Minimal 1,024 · low 2,048 ·
   medium 8,192 · high 16,384 · xhigh 20,480 · max 24,576 tokens
   (`LEGACY_REASONING_BUDGETS`), so every level works on a budget-only
   model. They are Axle's convention, not validated equivalents of any
   provider's named levels. The range is what every model in the legacy
   sets accepts: 1,024 is Anthropic's minimum and 24,576 is the ceiling of
   Gemini 2.5 Flash and Flash Lite. They are never derived from
   `maxOutputTokens`, never clamped, and never cause a caller-supplied
   output limit to change. A budget request cannot be sent without a
   number, so `{ enabled: true }` alone is rejected on a budget-only route
   (invariant 3) and no preset is invented for it. Budget is not a knob of
   the setting: no current model takes one, and an exact budget goes
   through `providerOptions`.
8. **No capability validation.** Axle sends the requested native fields and
   lets the provider reject unsupported combinations through the existing
   error path. There is no retry at a lower effort and no substitution.
   The catalog's record of a model's controls is for hosts and is never
   read on the request path. The rejections in invariants 1 and 3 are not
   capability checks: they are settings Axle has no field to send for.
9. **`providerOptions` wins.** Raw provider fields are spread after the
   portable mapping and override it field by field. Exact budgets, OpenAI
   summary lengths, and Anthropic's `updates` display stay there. A nested object is one field: overriding `thinking` on
   Anthropic replaces the whole object, `type` included.
10. **Enabling reasoning requests disclosure wherever a field exists.**
    `display` defaults to `"visible"` and rides along with every enable:
    Anthropic `thinking.display: summarized`, Gemini `includeThoughts: true`,
    OpenAI `reasoning.summary: auto`. `"hidden"` sends the explicit hide
    value on the same routes (`omitted`, `false`, no summary field) and
    `reasoning: { exclude: true }` on OpenRouter. Generic Chat Completions
    endpoints and Together AI have no field and send nothing either way. On
    every route the step reader also withholds thinking content from the
    turn under `"hidden"` while the message keeps what the wire carried
    (thinking.md invariant 9); this is how `"hidden"` holds on OpenRouter,
    whose `exclude` leaves `reasoning_details` text in place. A disable and
    `"default"` never carry a display field: a `display` beside
    `enabled: false` is dropped, and on Anthropic a display can only travel
    inside a typed `thinking` object.
11. **Display controls disclosure, not form.** The request says whether the
    provider should show its thinking. Whether a summary or raw text comes
    back is the model's property, recorded on the thinking part (see
    [thinking.md](thinking.md)), and no provider lets the caller choose it.
    The request values are therefore named for visibility, not for the part
    field they populate.

## Provider and model requirements

Researched 2026-09-07 against the providers' current documentation and the
`checks/` harness; the Opus 5.5 and Sonnet 5.5 rows were added 2026-10-01.
Re-verify this section when a model generation ships.

Which levels a model takes varies more than the tables below suggest. In
models.dev's per-provider listing on 2026-11-17, `medium` was absent from
1,521 of 5,470 effort lists (28%): `low, high, max` (605 entries) and
`none, high` (243) are common shapes, and `gpt-5-pro` takes `high` alone.
`minimal` appeared in 754 lists, `xhigh` in 2,250, and `max` in 2,840.

### Anthropic Messages API

| Generation                      | Thinking modes                                           | Disable                                                                                                   | Effort values                                                           | Default                    |
| ------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------- |
| Fable 5 / 5.1, Mythos           | adaptive only                                            | rejected (400)                                                                                            | low, medium, high, xhigh, max                                           | thinking on, effort high   |
| Opus 5.5                        | adaptive only                                            | rejected (400)                                                                                            | low, medium, high, xhigh, max                                           | thinking on, effort medium |
| Sonnet 5.5                      | adaptive only                                            | `disabled` rejected (400); `thinking.type: between_tools` stops up-front thinking at effort high or below | low, medium, high, xhigh, max                                           | thinking on, effort high   |
| Opus 5, Sonnet 5                | adaptive only                                            | `thinking.type: disabled` (Opus 5 rejects it at xhigh/max)                                                | low, medium, high, xhigh, max                                           | thinking on, effort high   |
| Opus 4.7, 4.8                   | adaptive only; `enabled` + budget returns 400            | `disabled`                                                                                                | low, medium, high, xhigh, max                                           | thinking off               |
| Opus 4.6, Sonnet 4.6            | adaptive or `enabled` + budget (budget deprecated)       | `disabled`                                                                                                | low, medium, high, max                                                  | thinking off               |
| Haiku 4.5, Opus 4.5, Sonnet 4.5 | `enabled` + `budget_tokens` only; `adaptive` returns 400 | `disabled`                                                                                                | Opus 4.5 accepts `output_config.effort` alongside a budget; others none | thinking off               |

Opus 4, Opus 4.1, Sonnet 4, and Sonnet 3.7 also used budgets but are retired
(June, August, June, and February 2026); Axle does not route for them.

Axle sends `disabled` for `off` on every Anthropic model, so `off` is
rejected on Sonnet 5.5 as it is on Opus 5.5 and Fable. `between_tools` is
reachable only through `providerOptions`.

Constraints that shape the translation:

- `max_tokens` is mandatory on every request and is the hard ceiling on
  thinking plus answer text. In manual mode `budget_tokens` must be at least
  1,024 and strictly less than `max_tokens`.
- `output_config.effort: high` is identical to omitting effort. Effort is a
  behavioral signal, not a budget; at low effort adaptive models may skip
  thinking on easy prompts.
- The `@anthropic-ai/sdk` client refuses a non-streaming request whose
  `max_tokens` implies more than ten minutes of output at its assumed 128k
  tokens/hour (about 21,333 tokens) unless the client has an explicit
  timeout. Axle sends only streaming requests since 0.32.0, so the guard
  constrains nothing Axle does.
- `thinking.display` defaults to `omitted` on Opus 4.7, 4.8, and every 5.x
  model, and to `summarized` on 4.6 and the budget models. Under `omitted`
  the server emits no `thinking_delta` events: blocks arrive with empty text
  and a signature. Axle sends `display` explicitly on every enable so the
  per-model default never decides what streams, and preserves the signature
  for continuity either way. `updates` (progress notes only) is a beta value
  the installed SDK does not type; it stays in `providerOptions`.

### Google Gemini GenerateContent

| Generation                       | Thinking control                | Disable                                                 | Levels                     | Notes                                |
| -------------------------------- | ------------------------------- | ------------------------------------------------------- | -------------------------- | ------------------------------------ |
| Gemini 3.1 Pro, 3.7 / 3.8 Flash  | `thinkingConfig.thinkingLevel`  | not possible; `thinkingBudget: 0` returns 400           | low, medium, high          | Pro cannot disable thinking          |
| Gemini 3.5 Flash Lite, 3.6 Flash | `thinkingLevel`                 | not possible; `thinkingBudget: 0` returns 400           | minimal, low, medium, high | minimal still thinks on hard prompts |
| Gemini 2.5 Pro                   | `thinkingConfig.thinkingBudget` | `thinkingBudget: 0` rejected by the model (minimum 128) | budget                     | thinking on by default               |
| Gemini 2.5 Flash, Flash Lite     | `thinkingBudget`                | `thinkingBudget: 0`                                     | budget                     | Flash Lite off by default            |
| Gemini 2.0 and older             | none                            | n/a                                                     | n/a                        | any `thinkingConfig` returns 400     |

The 2.5 budget ranges are 128–32,768 for Pro, 0–24,576 for Flash, and
512–24,576 for Flash Lite (models.dev, 2026-11-17).

Gemma 4 (26B A4B and 31B) through the Gemini API only switches. Google's
"Run Gemma with the Gemini API" page (2026-11-17) says to set the thinking
level "to `high` for enabled or `minimal` for disabled" and lists no other
value. Neither has been run in the harness.

Streaming responses from Gemini 3.5 Flash Lite carried no thought parts at
any effort in the harness (2026-09-07) even though `reasoningOut` was
non-zero; 3.1 Pro and 2.5 Flash Lite streamed a thinking part with a
signature but no summary text. Non-streaming responses carried summaries on
all three.

### OpenAI Responses API

`reasoning.effort` with `none | minimal | low | medium | high | xhigh | max`
depending on model. `none` is rejected by models that always think: GPT-6.1
Sol accepts only `low` through `max` (harness, 2026-10-01).
`reasoning.summary` with `auto | concise | detailed` requests a summary;
without it no summary parts are returned. Encrypted reasoning continuity
requires `store: false` and `include: ["reasoning.encrypted_content"]` via
`providerOptions`.

### OpenAI-compatible Chat Completions

- **Generic endpoints**: `reasoning_effort` with
  `none | low | medium | high`.
- **OpenRouter** (documentation, 2026-11-17): `reasoning_effort` and
  `reasoning.effort` are one enum, `max | xhigh | high | medium | low |
minimal | none`. `reasoning.enabled` is a boolean, and `enabled: true`
  "enables reasoning at the medium effort level". What a word outside the
  enum does is not documented. An effort the model does not support is not
  rejected: OpenRouter "will map your requested effort to the nearest
  supported level", so invariant 8's provider rejection does not happen on
  this route. Its models endpoint publishes `supported_efforts`,
  `default_enabled` and `mandatory` (the model rejects `none`) per model;
  Axle does not read them. OpenRouter's own translation to the upstream
  provider is upstream behavior; it picks `summarized` for Claude. Its only
  disclosure control is `reasoning.exclude: boolean`, which removes the
  convenience `reasoning` string from the response and nothing else:
  `reasoning_details` still arrive with text and signature (verified
  2026-09-11), since they exist for the round trip.
- **Together AI**: hybrid models (GLM, Qwen, Kimi, MiniMax, DeepSeek V3.1) toggle
  with `reasoning: { enabled }`; GPT-OSS and DeepSeek V4 accept
  `reasoning_effort` with `low | medium | high`. Neither family documents
  accepting both, and GLM-5.3-Flash accepted both in the harness. Its
  documentation (2026-11-17) lists MiniMax M3.1 Flash, DeepSeek V4 Pro,
  GLM-5.2, Kimi K3, Qwen3.6 Plus and Qwen3.5 9B as hybrid, all on by
  default. It does not reliably reject an effort a model lacks: DeepSeek V4
  Pro maps `low` and `medium` to `high`, and the Kimi K3 page says invalid
  effort strings are accepted silently.

## Axle translation

`resolveReasoning` collapses the setting to
`"default" | "off" | { effort?, display }`, where a missing `effort` is the
switch alone and `display` defaults to `"visible"`; each adapter maps that
request. `<effort>` is the effort as written and `<preset>` its row in the
second table:

| Route                                               | `{ enabled: false }`                       | `{ effort }`                                                       | `{ enabled: true }` alone               |
| --------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------- |
| Anthropic adaptive (every ID not in the legacy set) | `thinking: {type: disabled}`               | `thinking: {type: adaptive}` + `output_config: {effort: <effort>}` | `thinking: {type: adaptive}`            |
| Anthropic legacy budget                             | `thinking: {type: disabled}`               | `thinking: {type: enabled, budget_tokens: <preset>}`               | Axle throws                             |
| Gemini named levels (every ID in neither set)       | `thinkingConfig: {thinkingBudget: 0}`      | `thinkingConfig: {thinkingLevel: <effort>}`                        | Axle throws                             |
| Gemini toggle set (Gemma 4)                         | `thinkingConfig: {thinkingLevel: minimal}` | `thinkingConfig: {thinkingLevel: <effort>}`                        | `thinkingConfig: {thinkingLevel: high}` |
| Gemini legacy budget                                | `thinkingConfig: {thinkingBudget: 0}`      | `thinkingConfig: {thinkingBudget: <preset>}`                       | Axle throws                             |
| OpenAI Responses                                    | `reasoning: {effort: none}`                | `reasoning: {effort: <effort>}`                                    | Axle throws                             |
| Generic Chat Completions                            | `reasoning_effort: none`                   | `reasoning_effort: <effort>`                                       | Axle throws                             |
| OpenRouter                                          | `reasoning_effort: none`                   | `reasoning_effort: <effort>`                                       | `reasoning: {enabled: true}`            |
| Together AI                                         | `reasoning: {enabled: false}`              | `reasoning: {enabled: true}, reasoning_effort: <effort>`           | `reasoning: {enabled: true}`            |

The Anthropic switch alone is the adaptive request without its effort
field, so the model thinks at its own default depth. The switch shapes for
Together AI, OpenRouter and Gemma are the ones those providers document.
None of the switch-alone cells has been run in the harness.

| Level   | Legacy budget preset |
| ------- | -------------------- |
| minimal | 1,024                |
| low     | 2,048                |
| medium  | 8,192                |
| high    | 16,384               |
| xhigh   | 20,480               |
| max     | 24,576               |

Default sends no fields on every route. Every enabled cell above also
carries the route's display field:

| Route                          | `display: "visible"` (default) | `display: "hidden"`            |
| ------------------------------ | ------------------------------ | ------------------------------ |
| Anthropic, both routes         | `thinking.display: summarized` | `thinking.display: omitted`    |
| Gemini, both routes            | `includeThoughts: true`        | `includeThoughts: false`       |
| OpenAI Responses               | `reasoning.summary: auto`      | no summary field               |
| OpenRouter                     | nothing                        | `reasoning: { exclude: true }` |
| Generic endpoints, Together AI | nothing                        | nothing                        |

Under `"hidden"` the turn receives no thinking content on any route; the
step reader withholds it (thinking.md invariant 9). The switch alone with
`"hidden"` on OpenRouter is `reasoning: { enabled: true, exclude: true }`.

### Legacy budget sets

The Gemini set holds bare model IDs and is looked up exactly. The Anthropic
sets hold undated model names, matched anywhere in the lowercased ID and not
followed by a digit, so a dated ID or a Bedrock inference-profile ID
(`us.anthropic.claude-haiku-4-5-20251001-v1:0`) names the same model and
`claude-haiku-4-50` does not.

- **Anthropic** (`ANTHROPIC_THINKING_BUDGET_MODELS`): Haiku 4.5, Opus 4.5,
  Sonnet 4.5.
- **Gemini** (`GEMINI_THINKING_BUDGET_MODELS`): Gemini 2.5 Flash, Flash
  Lite, and Pro.

The Gemini toggle set (`GEMINI_THINKING_TOGGLE_MODELS`) is looked up the
same way and holds Gemma 4 26B A4B and Gemma 4 31B, the models whose switch
Google spells as `high` and `minimal`.

Retired models are not routed: a retired ID falls to the modern route where
the provider rejects it as unknown. Adding a model to a set is a same-diff
change to this document.

## Choosing a setting

Axle cannot say which knobs a model has without a registry it declines to
keep (invariant 8), so the choice is the host's, and the model catalog
carries what models.dev knows to help it make one.

A provider entry in `CatalogData` holds `reasoningOptions`, models.dev's
`reasoning_options` for that provider's model. models.dev's contributor
policy (`AGENTS.md`, read 2026-11-17) defines the three controls and treats
them as independent:

| models.dev control | `reasoningOptions` entry         | Its meaning                                                             |
| ------------------ | -------------------------------- | ----------------------------------------------------------------------- |
| `toggle`           | `{ type: "toggle" }`             | "Same model ID can be turned on/off via a request field"                |
| `effort`           | `{ type: "effort", values }`     | Graded levels in the provider's words, `none` included where it has one |
| `budget`           | `{ type: "budget", min?, max? }` | A real reasoning-token budget field                                     |
| none of them       | an empty list                    | "Always-on, no caller control"                                          |

A host whose levels include `none` is recorded with `effort` alone; a host
with a separate switch beside its levels is recorded with both. The wire
path of a toggle is kept only as a comment in the source file, so it never
reaches the catalog: that a model switches is known, how is each adapter's
knowledge (invariant 3). models.dev records all of this per provider and
not on its canonical layer, so `lookup()` returns it only for a provider
match. On 2026-11-17, of 7,843 reasoning models, 70% had an effort list, 5%
a budget and no list, 10% a toggle alone, and 15% an empty list.

`catalog.reasoningControl(model, { provider })` reads that record as the
kind of control a host should show and the setting to send:

| The provider's record                       | `control` | `efforts`                                | `suggested`                             |
| ------------------------------------------- | --------- | ---------------------------------------- | --------------------------------------- |
| An `effort` list with an effort Axle names  | `levels`  | Those efforts, lowest first              | `{ effort }`, the one closest to medium |
| A `budget` and no such list                 | `levels`  | All six, since every effort has a preset | `{ effort: "medium" }`                  |
| A `toggle` and neither of the above         | `toggle`  | None                                     | `{ enabled: true }`                     |
| An empty list, or the model does not reason | `none`    | None                                     | Absent                                  |

With no record, no provider match, or an unknown model, the method returns
`undefined`.

`suggested` is a `ReasoningConfig`, so it is what an on/off control sends
for "on": `reasoning: found.suggested`, or
`{ ...found.suggested, display: "hidden" }`. Among efforts it is the one
closest to medium, the higher one on a tie. A record with both a toggle and
efforts is `levels`, the finer control.

The answer is advisory. It is models.dev's data, which can be stale or
wrong, and a setting it suggests can still be rejected. It does not report
whether a model can be turned off. models.dev's rules make that derivable
(a toggle, or `none` among the efforts), but entries disagree with provider
documentation (Opus 4.7 accepts a disable and has neither), so a host sends
`{ enabled: false }` and the provider may reject it.

The CLI is such a host: a recipe's `on` is resolved through `suggested`
(cli.md).

## Anthropic output ceiling

Anthropic is the only adapter that must send an output cap, so it is the only
one with a library-owned default. There is one request path and one implicit
ceiling:

| Path                                               | Implicit `max_tokens` when the caller sets none |
| -------------------------------------------------- | ----------------------------------------------- |
| `stream()`, and therefore `generate()` and `Agent` | 128,000, or 64,000 for a model in the 64k set   |

The 64k set (`ANTHROPIC_64K_OUTPUT_MODELS`) is Haiku 4.5, Opus 4.5, and
Sonnet 4.5. Every Claude model since Opus 4.6
has a 128,000 ceiling, so an unknown ID is assumed to have one. A new model
with a lower ceiling is rejected by the provider until it joins the set or
the caller passes `maxOutputTokens`; adding it is a same-diff change to this
document. The set lists the same IDs as the legacy budget set today and is
kept separate because the two properties are independent.

A ceiling is not spend, so a high default costs nothing on short answers and
leaves every legacy preset room to fit. Caller-supplied `maxOutputTokens` is
sent untouched, and the provider rejects a budget that does not fit under it.

`PromptCompactor` sends no output cap, so its summarizer request takes the
same default and any preset fits.

## Harness coverage

`reasoning-efforts` sends low, medium and high. `reasoning-suggested`
sends the setting `reasoningControl()` suggests for the target, fetched
from models.dev at run time, and `reasoning-listed-efforts` (extended)
sends every effort it lists, or the switch for a toggle model; both run on
Anthropic, OpenAI, Gemini, OpenRouter and Together AI and fail when the
catalog has no record or no control for the target. Those two are the only
live coverage of minimal, xhigh and max, on targets that list them. No
default target is a toggle model, so the switch alone is covered by unit
tests only.

`checks/cases/reasoning.ts` runs `reasoning-off`, `reasoning-efforts`,
`reasoning-stream-effort`, `reasoning-suggested`, and
`reasoning-tool-continuity` on every default target (`reasoning-efforts`
also requires disclosed thinking text from at least one effort on
Anthropic, OpenAI, and Gemini), and pins models for
`reasoning-route-legacy` (Haiku 4.5, Gemini 2.5 Flash Lite),
`reasoning-route-modern` (Sonnet 4.6, `gemini-flash-lite-latest`), and
`reasoning-unsupported-error` (`off` on Fable 5.1 and Gemini 3.1 Pro).

## Rejected alternatives

- **A portable `"on"` fixed at medium** (2026-11-17, AXL-106): the design
  from 2026-09-07 until 0.37.0. `medium` is missing from 28% of the effort
  lists models.dev records, so `"on"` was a setting that failed on models
  the caller had not been told about. Any other fixed level has the same
  hole. 0.36 code that says `"on"` is now a type error.
- **A switch that works on every route** (2026-11-17): Anthropic, Together
  AI and OpenRouter can turn thinking on without naming a depth. OpenAI
  Responses and generic Chat Completions cannot, and the budget routes need
  a number, so there a switch would send nothing or an invented value.
  `enabled: true` is sent where the provider has a switch and rejected
  where it has none (invariant 3).
- **Sending nothing where a provider has no switch** (2026-11-17): the
  request would succeed and the model would run at its default, which for
  some models is no thinking.
- **Effort words at the top level, with `off` and `on` among them**
  (2026-11-17): built and replaced the same day, as
  `"default" | "off" | "on" | <level> | { effort, display? }`. No provider
  has an effort called `on`; Together AI, OpenRouter and Anthropic all
  carry the switch and the depth as two fields, and models.dev records them
  as two controls. 0.36's `"on"` would have compiled and changed meaning.
  A host reading a stored setting would handle two shapes, and a bare
  effort invites a bare `"off"`. The CLI takes the words instead (cli.md),
  since a recipe is written by hand.
- **A boolean as the whole setting** (2026-11-17, again): `true` says
  nothing about depth and `false` does not say whether it means off or the
  provider's default. `enabled` is a boolean, but it is one knob, named for
  the provider field it becomes, beside `effort`.
- **An effort as the switch for a toggle model** (2026-11-17): asking the
  host for any effort means sending one the model does not have. Together
  AI then gets `enabled: true` beside an effort word, a combination it does
  not document.
- **A budget preset for the switch alone** (2026-11-17): 8,192 would make
  "on" mean medium again on the budget routes.
- **A budget knob on the setting** (2026-11-17): models.dev has three
  control types and the setting carries two. Every model that takes only a
  budget is historical; the presets keep them working.
- **Dropping `"default"`** (2026-11-17): an explicit `undefined` already
  resets an Agent-level setting on one send, since the options are merged
  by spreading. A reset should be sayable in words.
- **`thinkingLevel: high` and `minimal` for every Gemini model**
  (2026-11-17): on Gemini's level models `minimal` is a real depth and
  does not turn thinking off. The Gemma meaning applies to a bounded set.
- **Resolving a host's "on" from the catalog on the request path**
  (2026-11-17): the request would depend on whether a catalog was loaded
  and on third-party data, and the setting sent would not appear at the
  call site. The catalog's `suggested` gives the host the same pick where
  it can see it. The CLI makes that pick as a host (cli.md): the library
  sends what the caller wrote, and the friendly choice belongs to the host.
- **Rejecting levels without a preset on budget-only models** (2026-11-17):
  one setting would stop working across the models a host can select. The
  legacy sets are six frozen models, so a full table is nothing to
  maintain.
- **The middle of the model's list as `suggested`** (2026-11-17): one line,
  but it drifts upward as providers add levels at the top. It picks high
  for `low, medium, high, xhigh, max`, the shape of every current Claude
  model, and max for `high, max`. Closest to medium stays a moderate
  choice.
- **Reasoning options on the canonical catalog model** (2026-11-17):
  models.dev records them per provider only, and the same model takes
  different levels through different providers.

- **A fixed `summarized` with no portable knob** (2026-09-10): the only
  opt-out would be `providerOptions`, which replaces the whole `thinking`
  object, so skipping thinking tokens for time-to-first-token would mean
  restating `type` and, on budget models, `budget_tokens`. Disclosure is a
  separate request field on every native provider; it earns the same
  portable treatment as on/off and effort.
- **`summary: boolean`** (2026-09-10): the 0.30 boolean on `reasoning`
  itself was already replaced by named values once; and Anthropic's
  `updates` mode is a third disclosure state a boolean cannot hold.
- **Summary levels (`"concise" | "detailed"`)** (2026-09-10): only OpenAI
  has levels. Anthropic and Gemini would silently collapse them, the same
  silent drop that rejected Together AI `enabled`-only. The intersection every
  provider shares is binary.
- **Values named for the part field (`"summary" | "none"`)** (2026-09-10):
  no provider lets the caller choose the form. An open-weight model answers
  a `"summary"` request with raw text, so the value would promise what the
  request cannot deliver. Visibility is what the request controls.
- **Display as a sibling option outside the effort object** (2026-09-10):
  Gemini and OpenAI could send the flag alone, Anthropic cannot. Nesting it
  under `{ effort }` makes the rule structural on every route instead of
  documented for one.

- **`on` = high effort** (2026-09-07; `on` itself was removed 2026-11-17):
  the previous boolean mapped `true` to
  the highest named level. No portable-API precedent supports it; OpenRouter
  documents `enabled: true` as medium, and Anthropic's own default is high
  only because high equals omission. `on` is medium so that "turn it on" is a
  moderate choice and the caller reaches for `{ effort: "high" }` on purpose.
- **Keeping booleans as deprecated aliases** (2026-09-07): `true → on` would
  silently drop today's high mapping and `false → off` would change
  Anthropic from omission to an explicit disable that Fable rejects. A type
  error at the call site is clearer than a behavior change hidden behind a
  deprecation.
- **Regex model classification** (2026-09-07): the family/version regex
  misclassified `claude-opus-5` and `claude-fable-5-1` as legacy, and the
  Gemini regex dropped `-latest` aliases entirely. A bounded set fails
  toward the modern syntax, which every new model ships with.
- **Budgets as a fraction of `maxOutputTokens`, or clamped to fit** (2026-09-07):
  couples thinking depth to an unrelated limit and hides the provider's
  rejection.
- **A capability registry with early errors** (2026-09-07): would need
  maintenance per model release and duplicates what the provider already
  enforces.
- **One shared Anthropic ceiling at the model maximum for both paths**
  (2026-09-07): rejected in the harness by the SDK's non-streaming guard.
  Skipping the guard with an explicit timeout would let a 64k-token
  unattended call hang for the full timeout.
- **A tiered `generate()` default (16,000, raised per legacy budget up to
  21,000)** (2026-09-07): three constants to express what one does. The
  historical 16,000 protected nothing, since a ceiling only matters when the
  model actually runs that long.
- **Together AI `enabled` only** (2026-09-07): drops an explicit effort
  silently, which invariant 8 forbids.
- **Two transports behind two public functions** (2026-09-12, AXL-55): the
  buffered `generate()` loop and the four `createGenerationRequest` builders
  were deleted; `generate(o)` is `stream(o).final`. The two Anthropic
  ceilings above were the visible symptom of the drift that two transports
  invite, and the SDK's non-streaming guard only ever mattered because the
  buffered path existed. The two entries above about a `generate()` ceiling
  are kept as history; there is no longer a second ceiling to choose.
- **The output ceiling from a generated model registry, else 64,000**
  (2026-09-29): the default until the `Models` registry was removed. It
  capped a new 128k model at 64,000 silently until the registry was
  regenerated, and the ceiling was the only registry data core read. A
  128,000 default with a fixed 64k set fails loudly on the rare lower
  ceiling instead, and needs no per-release maintenance.
- **The output ceiling from Anthropic's Models API** (2026-09-29): the API
  reports `max_tokens` per model, but a library default would cost a network
  call before the first request.
