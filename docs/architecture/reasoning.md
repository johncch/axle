# Reasoning controls

**Status**: current · **Last design revision**: 2026-09-07 (0.31.0)

This document is normative for Axle's portable reasoning control: what the
`reasoning` request option means, how each provider adapter translates it,
and which model generations take which request syntax. Code and tests are
built against it; divergence is a defect. The provider requirements section
records what the vendors demanded on the research date so the translation
can be re-checked when they change.

## Invariants

1. **One portable setting.** `reasoning?: ReasoningSetting` where
   `ReasoningSetting = "default" | "off" | "on" | { effort: "low" | "medium" | "high" }`.
   It is the same option on `Agent`, `generate()`, `stream()`,
   `PromptCompactor`, and the CLI's `request` block. Booleans are not
   accepted.
2. **`"default"` and omission send nothing.** No reasoning field reaches the
   wire on any route; the model runs at its provider's own default, which may
   be thinking-on (Sonnet 5, Opus 5, Fable, Gemini 2.5 Pro) or thinking-off
   (Opus 4.6–4.8, Haiku 4.5). Axle does not resolve or report which.
3. **`"on"` is `{ effort: "medium" }`.** It enables reasoning; it does not
   promise a visible thinking block or thinking on every adaptive-model
   response.
4. **`"off"` sends the provider's explicit disable shape.** Never `minimal`,
   never `low`, never omission. Models that cannot disable thinking reject
   the request and the provider error surfaces unchanged.
5. **Effort is relative within a model.** Low/medium/high are not comparable
   compute, latency, or token spend across models or providers.
6. **Route selection is a bounded ID set, not a pattern.** Each adapter that
   has two request syntaxes owns an explicit, lowercased set of the model IDs
   that take the legacy token-budget syntax
   (`ANTHROPIC_THINKING_BUDGET_MODELS`, `GEMINI_THINKING_BUDGET_MODELS`).
   Everything else, including aliases such as `gemini-flash-lite-latest` and
   IDs Axle has never seen, takes the modern named-effort syntax. No regex,
   no family/version parsing.
7. **Legacy presets are fixed.** Low 2,048 · medium 8,192 · high 16,384
   tokens (`LEGACY_REASONING_BUDGETS`). They are Axle's convention, not
   validated equivalents of any provider's named levels. They are never
   derived from `maxOutputTokens`, never clamped, and never cause a
   caller-supplied output limit to change.
8. **No capability validation.** Axle sends the requested native fields and
   lets the provider reject unsupported combinations through the existing
   error path. There is no retry at a lower effort and no substitution.
9. **`providerOptions` wins.** Raw provider fields are spread after the
   portable mapping and override it field by field. Exact budgets,
   `xhigh`/`max`, and thinking-display controls stay there.
10. **Enabling reasoning on Gemini requests thought summaries.**
    `includeThoughts: true` rides along with every enable so Axle's thinking
    parts are populated; `off` and `default` do not set it.

## Provider and model requirements

Researched 2026-09-07 against the vendors' current documentation and the
`checks/` harness. Re-verify this section when a model generation ships.

### Anthropic Messages API

| Generation                      | Thinking modes                                           | Disable                                                    | Effort values                                                           | Default                  |
| ------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------ |
| Fable 5 / 5.1, Mythos           | adaptive only                                            | rejected (400)                                             | low, medium, high, xhigh, max                                           | thinking on, effort high |
| Opus 5, Sonnet 5                | adaptive only                                            | `thinking.type: disabled` (Opus 5 rejects it at xhigh/max) | low, medium, high, xhigh, max                                           | thinking on, effort high |
| Opus 4.7, 4.8                   | adaptive only; `enabled` + budget returns 400            | `disabled`                                                 | low, medium, high, xhigh, max                                           | thinking off             |
| Opus 4.6, Sonnet 4.6            | adaptive or `enabled` + budget (budget deprecated)       | `disabled`                                                 | low, medium, high, max                                                  | thinking off             |
| Haiku 4.5, Opus 4.5, Sonnet 4.5 | `enabled` + `budget_tokens` only; `adaptive` returns 400 | `disabled`                                                 | Opus 4.5 accepts `output_config.effort` alongside a budget; others none | thinking off             |

Opus 4, Opus 4.1, Sonnet 4, and Sonnet 3.7 also used budgets but are retired
(June, August, June, and February 2026); Axle does not route for them.

Constraints that shape the translation:

- `max_tokens` is mandatory on every request and is the hard ceiling on
  thinking plus answer text. In manual mode `budget_tokens` must be at least
  1,024 and strictly less than `max_tokens`.
- `output_config.effort: high` is identical to omitting effort. Effort is a
  behavioral signal, not a budget; at low effort adaptive models may skip
  thinking on easy prompts.
- The `@anthropic-ai/sdk` client throws before sending a non-streaming
  request whose `max_tokens` implies more than ten minutes of output at its
  assumed 128k tokens/hour (about 21,333 tokens). The check is skipped when
  the client was constructed with an explicit timeout. Streaming requests are
  exempt.
- Thinking display defaults to `omitted` on many models: thinking blocks
  arrive with an empty text and a signature. Axle preserves the signature for
  continuity and leaves display selection to `providerOptions`.

### Google Gemini GenerateContent

| Generation                       | Thinking control                | Disable                                                 | Levels                     | Notes                                |
| -------------------------------- | ------------------------------- | ------------------------------------------------------- | -------------------------- | ------------------------------------ |
| Gemini 3.1 Pro, 3.7 / 3.8 Flash  | `thinkingConfig.thinkingLevel`  | not possible; `thinkingBudget: 0` returns 400           | low, medium, high          | Pro cannot disable thinking          |
| Gemini 3.5 Flash Lite, 3.6 Flash | `thinkingLevel`                 | not possible; `thinkingBudget: 0` returns 400           | minimal, low, medium, high | minimal still thinks on hard prompts |
| Gemini 2.5 Pro                   | `thinkingConfig.thinkingBudget` | `thinkingBudget: 0` rejected by the model (minimum 128) | budget                     | thinking on by default               |
| Gemini 2.5 Flash, Flash Lite     | `thinkingBudget`                | `thinkingBudget: 0`                                     | budget                     | Flash Lite off by default            |
| Gemini 2.0 and older             | none                            | n/a                                                     | n/a                        | any `thinkingConfig` returns 400     |

Streaming responses from Gemini 3.5 Flash Lite carried no thought parts at
any effort in the harness (2026-09-07) even though `reasoningOut` was
non-zero; 3.1 Pro and 2.5 Flash Lite streamed a thinking part with a
signature but no summary text. Non-streaming responses carried summaries on
all three.

### OpenAI Responses API

`reasoning.effort` with `none | minimal | low | medium | high | xhigh`
depending on model. `none` is rejected by models that always think. Encrypted
reasoning continuity requires `store: false` and
`include: ["reasoning.encrypted_content"]` via `providerOptions`.

### OpenAI-compatible Chat Completions

- **Generic endpoints and OpenRouter**: `reasoning_effort` with
  `none | low | medium | high`. OpenRouter's own translation to the upstream
  provider is upstream behavior.
- **Together**: hybrid models (GLM, Qwen, Kimi, MiniMax, DeepSeek V3.1) toggle
  with `reasoning: { enabled }`; GPT-OSS and DeepSeek V4 accept
  `reasoning_effort` with `low | medium | high`. Neither family documents
  accepting both, and GLM-5.3-Flash accepted both in the harness.

## Axle translation

`resolveReasoning` collapses the setting to `"default" | "off" | ReasoningEffort`
(with `"on"` → `"medium"`); each adapter maps that request:

| Route                                                | Off                                   | Low                                                           | On / Medium       | High            |
| ---------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------- | ----------------- | --------------- |
| Anthropic adaptive (every ID not in the legacy set)  | `thinking: {type: disabled}`          | `thinking: {type: adaptive}` + `output_config: {effort: low}` | adaptive + medium | adaptive + high |
| Anthropic legacy budget                              | `thinking: {type: disabled}`          | `thinking: {type: enabled, budget_tokens: 2048}`              | enabled + 8192    | enabled + 16384 |
| Gemini named levels (every ID not in the legacy set) | `thinkingConfig: {thinkingBudget: 0}` | `{thinkingLevel: low, includeThoughts: true}`                 | medium            | high            |
| Gemini legacy budget                                 | `{thinkingBudget: 0}`                 | `{thinkingBudget: 2048, includeThoughts: true}`               | 8192              | 16384           |
| OpenAI Responses                                     | `reasoning: {effort: none}`           | `{effort: low}`                                               | medium            | high            |
| Chat Completions, OpenRouter                         | `reasoning_effort: none`              | low                                                           | medium            | high            |
| Together                                             | `reasoning: {enabled: false}`         | `reasoning: {enabled: true}, reasoning_effort: low`           | medium            | high            |

Default sends no fields on every route.

### Legacy budget sets

Both sets hold registry IDs (`Models` in `models.ts`, publisher-prefixed),
so a legacy model must exist there first. The adapters receive the bare ID
and normalize it to the registry key (lowercased, prefix re-added) for both
the set lookup and the output-ceiling lookup.

- **Anthropic** (`ANTHROPIC_THINKING_BUDGET_MODELS`): Haiku 4.5, Opus 4.5,
  Sonnet 4.5, each in alias and dated form.
- **Gemini** (`GEMINI_THINKING_BUDGET_MODELS`): Gemini 2.5 Flash, Flash
  Lite, and Pro.

Retired models are not routed: the registry's roughly two-year window is the
support horizon, and a retired ID falls to the modern route where the
provider rejects it as unknown. Adding a model to a set is a same-diff
change to this document.

## Anthropic output ceilings

Anthropic is the only adapter that must send an output cap, so it is the only
one with a library-owned default. The two request paths differ because of the
SDK's non-streaming guard above, and the difference is deliberate:

| Path                               | Implicit `max_tokens` when the caller sets none                    |
| ---------------------------------- | ------------------------------------------------------------------ |
| `stream()` (and therefore `Agent`) | the model's `maxOutputTokens` from the model registry, else 64,000 |
| `generate()`                       | 21,000, the largest value under the SDK's non-streaming guard      |

A ceiling is not spend, so the flat 21,000 costs nothing on short answers and
leaves 4,616 tokens above the high legacy preset. Caller-supplied
`maxOutputTokens` is sent untouched on both paths, and the provider rejects a
budget that does not fit under it.

`PromptCompactor` sends no output cap, so its summarizer request takes these
same defaults and any preset fits.

## Harness coverage

`checks/cases/reasoning.ts` runs `reasoning-off`, `reasoning-efforts`,
`reasoning-stream-effort`, and `reasoning-tool-continuity` on every default
target, and pins models for `reasoning-route-legacy` (Haiku 4.5, Gemini 2.5
Flash Lite), `reasoning-route-modern` (Sonnet 4.6, `gemini-flash-lite-latest`),
and `reasoning-unsupported-error` (`off` on Fable 5.1 and Gemini 3.1 Pro).

## Rejected alternatives

- **`on` = high effort** (2026-09-07): the previous boolean mapped `true` to
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
- **Together `enabled` only** (2026-09-07): drops an explicit effort
  silently, which invariant 8 forbids.
