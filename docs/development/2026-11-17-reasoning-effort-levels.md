# Reasoning effort levels, and the end of `"on"` (AXL-106)

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
- The vocabulary across all lists is `none, minimal, low, medium, high,
xhigh, max`, plus two stray `default`s. Anthropic, OpenAI and Gemini use
  the same names, so a level can go to the wire unchanged.
- The canonical layer (`models.json`) carries none of it. The same model
  takes different levels through different providers.
- There is no preferred or default level in the data.
- Budget ranges: Gemini 2.5 Pro 128–32,768, Flash 0–24,576, Flash Lite
  512–24,576.

## What landed

- `ReasoningEffort` is `minimal | low | medium | high | xhigh | max`, and
  `REASONING_EFFORTS` is exported as the list. Named-effort routes forward
  the level as written; the Anthropic adapter casts past the SDK type,
  which has no `minimal`.
- `"on"` is gone from core and from the CLI's recipe schema. No alias. A
  recipe that still says `on` is told what to write instead.
- `LEGACY_REASONING_BUDGETS` has a preset for every level, topping out at
  24,576, the ceiling of Gemini 2.5 Flash and Flash Lite.
- `CatalogData` is version 5. A provider entry holds `reasoningOptions`,
  and `ModelCatalog.reasoningEfforts(model, { provider })` returns
  `{ efforts, suggested, id }`.

## How the design moved

The first reading of the second bullet was a configurable mapping for
`"on"`. The discussion went the other way: give up the portable `"on"`,
expose the levels, let the provider reject, and have the host map its own
toggle. Portability across models was the thing being given up, on the
view that it was never real.

That left the host with no way to pick a level except trial and error,
which is where the catalog came in. It answers "which levels can I offer
for this model", and `suggested` answers "which one does a plain on/off
toggle send". The host calls it and sees the value, so the pick is not
hidden in the request path.

`suggested` has to be derived, since models.dev has no preferred level.
Two rules were on the table: the middle of the list, and the level closest
to medium with ties going up. The middle picks high for the five-level
shape every current Claude model has, and max for `high, max`; closest to
medium keeps a toggle moderate. Ties go up because `low, high, max` is the
third most common shape and adaptive models may skip thinking at low.

For budget-only models the first proposal was to reject levels without a
preset. The models are six and frozen, so a full table won out.

## Not done

- The catalog does not say whether a model can be turned off. models.dev
  does not record it reliably.
- `checks/` still sends low, medium and high in `reasoning-efforts`. No
  default target takes all six levels.
- The CLI does not consult `reasoningEfforts()`; a recipe names its level.
