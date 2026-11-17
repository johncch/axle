# Reasoning as a model's own knobs (AXL-106)

Working note. The ticket asked for more thinking knobs: the levels beyond
low, medium and high, and "a knob for on for consumers to map".

## Starting point

`reasoning` was `"default" | "off" | "on" | { effort: "low" | "medium" |
"high", display? }`, with `"on"` fixed at medium since 2026-09-07. `xhigh`
and `max` were reachable only through `providerOptions`.

The problem that prompted the ticket: `"on"` = medium does not hold. Some
models have no medium level, so a host's thinking toggle failed on them
with a provider error the host had done nothing to cause.

## What the data said

models.dev publishes `reasoning_options` on every reasoning model in its
per-provider layer, 7,843 entries on 2026-11-17, and the catalog's parser
was dropping it.

- `medium` is absent from 1,521 of 5,470 effort lists (28%). `low, high,
max` has 605 entries, `none, high` 243, and `gpt-5-pro` takes `high`
  alone.
- By kind of control: 70% of reasoning models have an effort list, 5% a
  budget and no list, 10% a toggle alone, and 15% an empty list.
- The vocabulary across all lists is `none, minimal, low, medium, high,
xhigh, max`, plus two stray `default`s. Anthropic, OpenAI and Gemini use
  the same names, so an effort can go to the wire unchanged.
- The canonical layer (`models.json`) carries none of it. The same model
  takes different levels through different providers: Gemma 4 is a toggle
  on Google, `none, high` on Bedrock, and a full level list elsewhere.
- Budget ranges: Gemini 2.5 Pro 128–32,768, Flash 0–24,576, Flash Lite
  512–24,576.

models.dev's contributor policy (`AGENTS.md`) defines the controls, which
the README does not. A toggle is "same model ID can be turned on/off via a
request field". Levels that include `none` are recorded as `effort` alone;
a separate switch beside levels is recorded as both. No control at all
means "always-on, no caller control", not uncertainty. Each toggle's wire
path is kept as a comment in the source file and is not in the published
API. The source schema also has an optional `default` control, which the
published entries read on 2026-11-17 did not carry.

The providers' own shapes, from their documentation the same day:

- **Together AI:** `reasoning: { enabled: true | false }` for hybrid
  models, `reasoning_effort` for effort models, and some models take both.
  It can map or silently accept an effort a model lacks.
- **OpenRouter:** `reasoning.enabled` is a boolean, and alone means
  medium. The effort enum is `max` to `none`. An effort the model lacks is
  mapped to the nearest one.
- **Anthropic:** `thinking.type` is the switch and `output_config.effort`
  the depth.
- **OpenAI:** no switch; off is the effort `none`.
- **Gemini:** no switch. Gemma 4 only switches, spelled as `thinkingLevel`
  `high` and `minimal`.

## What landed

- `ReasoningSetting` is `"default" | { enabled?, effort?, display? }`.
  `ReasoningEffort` is the six levels, `REASONING_EFFORTS` the list, and
  `ReasoningConfig` the object.
- Each adapter sends each knob as its provider spells it. An effort goes
  out as written. `enabled: true` alone is the provider's switch where it
  has one (Anthropic adaptive, Together AI, OpenRouter, Gemma on Gemini)
  and throws where it has none. `enabled: false` is the provider's disable.
- `LEGACY_REASONING_BUDGETS` has a preset for every effort, topping out at
  24,576, the ceiling of Gemini 2.5 Flash and Flash Lite. Budget is not a
  knob of the setting.
- `CatalogData` is version 5. A provider entry holds `reasoningOptions`,
  and `ModelCatalog.reasoningControl(model, { provider })` returns
  `{ control, efforts, suggested, id }`, where `suggested` is a setting.
- The CLI keeps words in recipes (`default`, `off`, `on`, an effort) and
  turns them into the setting. `on` resolves through `suggested`, else
  medium, and the pick is logged beside the context window.
- `checks/` gains `reasoning-suggested` and, extended,
  `reasoning-listed-efforts`, both driven by the catalog.

## How the design moved

The setting was built three times in one day.

**First: six levels, no `"on"`.** The first reading of the second bullet
was a configurable mapping for `"on"`. The discussion went the other way:
give up the portable `"on"`, expose the levels, let the provider reject,
and have the host map its own toggle. Portability across models was the
thing being given up, on the view that it was never real. The catalog came
in so a host would not have to pick by trial and error, as
`reasoningEfforts()`, returning the listed levels and a `suggested` one.

**Second: effort words, with `on` passed through.** Review of the first
build found the hole: a quarter of reasoning models have no effort list,
and the method returned an empty list for all of them, so a host could not
tell a model with an on/off switch from one that cannot think. `on` came
back as a word with no meaning in Axle, sent as the provider's switch or
as the word; `off` joined it as an effort; the setting became a word or
`{ effort, display }`; and `reasoningControl()` replaced
`reasoningEfforts()` to report the kind of control.

**Third: the model's own knobs.** `effort: "on"` sat badly. No provider
has an effort called on, and 0.36 code saying `"on"` would have compiled
and changed meaning. Reading how the providers take it settled the shape:
three of five carry the switch and the depth as two fields, and models.dev
records them as two controls. So the setting carries both as fields, each
adapter turns each knob into its provider's shape, and a knob with no
shape on a provider throws there. The stance behind it: prefer the
default, and a caller that supplies a knob has to know what it is
supplying. Budget was the one control left out, as historical.

Smaller decisions along the way:

- **Bare strings.** A top-level effort was dropped from the library and
  kept in recipes. `"default"` was dropped and then restored, because a
  per-send override should be able to reset an Agent-level setting in
  words.
- **The CLI.** Core passing a literal through would have broken every
  recipe that says `on` on a Claude or GPT model, and mapping `on` to
  `default` would have run such recipes without thinking on models whose
  default is off. The CLI resolves `on` through the catalog, which leaves
  working recipes on medium and fixes the ones medium failed. The
  principle stated for it: the library is accurate, the CLI is where the
  friendlier behavior lives.
- **Gemma on Google.** models.dev says the model toggles; Google says the
  toggle is two level words. "A toggle is whatever the provider's API
  defines" put that knowledge in the Gemini adapter, as a bounded model
  set.
- **`suggested`.** It has to be derived, since the published data has no
  preferred level. The middle of the list picks high for the five-level
  shape every current Claude model has, and max for `high, max`; closest
  to medium keeps a toggle moderate. Ties go up because `low, high, max`
  is the third most common shape and adaptive models may skip thinking at
  low.
- **Budget-only models.** The first proposal was to reject levels without
  a preset. The models are six and frozen, so a full table won out.
- **An `off` flag on the catalog's answer.** Proposed, then dropped on the
  belief that models.dev did not record it. Its policy does define it (a
  toggle, or `none` among the efforts), though entries disagree with
  provider documentation. Left out; not revisited.

## Not done

- The catalog does not say whether a model can be turned off.
- No live run has sent the switch alone or the Gemma values. No default
  check target is a toggle model.
- OpenRouter's models endpoint publishes `supported_efforts`,
  `default_enabled` and `mandatory` per model, better data than models.dev
  for that route. Axle does not read it.
- models.dev's optional `default` control is not read.
- models.dev records Google's Gemma 4 as a toggle where Google documents
  two levels. Not raised upstream.
