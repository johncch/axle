# Reasoning efforts as words, and what `on` means (AXL-106)

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
was dropping it. Three shapes: `effort` with `values`, `budget_tokens` with
`min`/`max`, and `toggle`.

- `medium` is absent from 1,521 of 5,470 effort lists (28%). `low, high,
max` has 605 entries, `none, high` 243, and `gpt-5-pro` takes `high`
  alone.
- By kind of control: 70% of reasoning models have an effort list, 5% a
  budget and no list, 10% a toggle alone, and 15% an empty record.
- The vocabulary across all lists is `none, minimal, low, medium, high,
xhigh, max`, plus two stray `default`s. Anthropic, OpenAI and Gemini use
  the same names, so a level can go to the wire unchanged.
- The canonical layer (`models.json`) carries none of it. The same model
  takes different levels through different providers.
- There is no preferred or default level in the data.
- Budget ranges: Gemini 2.5 Pro 128–32,768, Flash 0–24,576, Flash Lite
  512–24,576.

OpenRouter's documentation, read the same day: `reasoning.enabled` is a
boolean and `enabled: true` is medium; the effort enum is `max` to `none`
and has no `on`; an effort the model lacks is mapped to the nearest one,
not rejected.

## What landed

- `ReasoningSetting` is `"default"`, an effort word, or `{ effort,
display? }`. `ReasoningEffort` is `off | on` plus the six levels
  (`ReasoningLevel`). `REASONING_LEVELS` and `REASONING_EFFORTS` are
  exported.
- Named-effort routes forward the effort as written; the Anthropic and
  OpenAI adapters cast past SDK types that lack some words.
- `on` is a passthrough. Together AI and OpenRouter get `reasoning: {
enabled: true }`; every other route gets the word; a budget-only route
  throws.
- `LEGACY_REASONING_BUDGETS` has a preset for every level, topping out at
  24,576, the ceiling of Gemini 2.5 Flash and Flash Lite.
- `CatalogData` is version 5. A provider entry holds `reasoningOptions`,
  and `ModelCatalog.reasoningControl(model, { provider })` returns
  `{ control, efforts, suggested, id }`.
- The CLI resolves a recipe's `on` through `suggested`, else medium, and
  logs the effort beside the context window.
- `checks/` gains `reasoning-suggested` and, extended,
  `reasoning-listed-efforts`, both driven by the catalog.

## How the design moved

The first reading of the second bullet was a configurable mapping for
`"on"`. The discussion went the other way: give up the portable `"on"`,
expose the levels, let the provider reject, and have the host map its own
toggle. Portability across models was the thing being given up, on the
view that it was never real.

That left the host with no way to pick a level except trial and error,
which is where the catalog came in. The first build removed `"on"`
outright and added `reasoningEfforts()`, returning the listed levels and a
`suggested` one.

Review of that build found the hole: a quarter of reasoning models have no
effort list, and the method returned an empty list for all of them, so a
host could not tell a model with an on/off switch from one that cannot
think. Two changes followed.

- **`on` came back as a word, not a feature.** Sending any level to a
  toggle model would have been the thing the ticket set out to stop. `on`
  is what those models take, so it is an effort like the others: valid
  where the model has it, rejected elsewhere. Axle gives it no meaning. A
  budget preset for it was proposed and dropped for that reason.
- **The catalog reports the kind of control.** `reasoningControl()`
  replaced `reasoningEfforts()`; a toggle model reports `efforts: ["on"]`,
  so the host's "on" is always `suggested`.

With `on` inside the effort vocabulary, `off` outside the object looked
wrong, and the setting was flattened to a word or an object. Booleans and
an object-only shape were considered and turned down.

An `off` flag on the catalog's answer was proposed and dropped: models.dev
records it for some providers only, and `off` is an explicit word the host
sends.

The last decision was the CLI. Core passing `on` through would break
every recipe that says `on` on a Claude or GPT model. Mapping it to
`default` was considered and would have run such recipes without thinking
on models whose default is off. The CLI resolves `on` through the
catalog, which leaves working recipes on medium and fixes the ones medium
failed. The principle stated for it: the library is accurate, the CLI is
where the friendlier behavior lives.

`suggested` has to be derived, since models.dev has no preferred level.
Two rules were on the table: the middle of the list, and the level closest
to medium with ties going up. The middle picks high for the five-level
shape every current Claude model has, and max for `high, max`; closest to
medium keeps a toggle moderate. Ties go up because `low, high, max` is the
third most common shape and adaptive models may skip thinking at low.

For budget-only models the first proposal was to reject levels without a
preset. The models are six and frozen, so a full table won out.

## Not done

- The catalog does not say whether a model can be turned off.
- No live run has sent `on`. No default check target is a toggle model,
  and the word routes are expected to reject it but have not been tried.
- OpenRouter's models endpoint publishes `supported_efforts`,
  `default_enabled` and `mandatory` per model, better data than models.dev
  for that route. Axle does not read it.
- A true enable-without-a-level on the routes that can express one
  (Anthropic adaptive, Gemini) was left out; `on` there is the word.
