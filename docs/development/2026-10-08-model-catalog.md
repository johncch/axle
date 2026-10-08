# Model catalog and the resolved context window (AXL-73)

Working note for two things that landed together: `ModelCatalog` in core,
and the CLI resolving a model's context window from it instead of assuming
200,000 tokens.

## Starting point

0.33.0 removed core's model registry: a static, partial replica of model
metadata with constant semantics — `Models.OpenAI.GPT_5_5`, one wire id per
model, OpenRouter slug rewriting. The CLI then assumed 200,000 tokens for
every model unless `AXLE_CONTEXT_WINDOW` was set, so 1M-context models
compacted at 160,000 with nothing configured.

The ticket started as a CLI-only lookup against `models.json` with a recipe
key and a profile key. Planning it surfaced the session/config separation
(2026-10-07 note), which dropped the recipe key: the window is a property of
the endpoint and model, not the task, and a provider's value travels with
the provider.

## Why core, and why this is not the registry coming back

The CLI is not the only host with compaction: axle-code and any library
consumer using `PromptCompactor` need a threshold, and `agent.context()`
already has a `limit` slot nothing filled. So the lookup is a core utility.

It differs from the removed registry on every point that was rejected: no
shipped table, no constants, no id rewriting, opt-in. The caller passes the
host and publisher as it sees fit.

## Two layers, because consumers are host-dependent

models.dev publishes `models.json` (447 entries, canonical
`publisher/model`, host-independent) and `api.json` (226 hosts, each host's
own ids with its limits and prices, 5.3 MB). Axle's consumers trade in host
ids — first-party and OpenRouter in sunnyday and R5V0, Together in checks —
and open-weight models are named differently on every host. `api.json`
entries carry `canonical_model_id` (5,367 of 8,451; every one resolves),
which makes a host-aware lookup exact where the canonical-only design would
have been a best-effort guess.

So `lookup(model, { host })` tries the host's own id first (a first-party
publisher prefix is stripped when it names the host, since
`resolveFirstPartyModel` strips it before the request too), then the
canonical key, then the best-effort match that remains for local runtimes.
Pricing came free from the host entry, so it stopped being a follow-up.

Measured before deciding to download `api.json` by default: 535 KB gzip /
378 KB brotli on the wire, 0.2–0.4 s, 46 ms to parse, a 0-byte 304 on
revalidation. Slimmed to all hosts the cache is 1.9 MB (the ~2,900
host-only entries with no canonical record carry a full record); `hosts`
trims it, `hosts: []` skips the layer. Price lives only in `api.json`, per
host, which is right — OpenRouter and Anthropic charge differently for the
same weights.

## Decisions along the way

- `refresh()` is unconditional and `stale` is a getter; a method called
  refresh that could no-op was confusing, and the once-a-day policy is the
  host's to state at the call site.
- `cachePath` is optional; a server holds the catalog in memory.
- One typed `CatalogModel` record from `lookup()` rather than per-field
  getters: the match is the fallible step and should run once. The record
  keeps `limit`, `reasoning`, `toolCall`, `structuredOutput`, `attachment`,
  `modalities`, `knowledge`; only `limit.context` is wired today. models.dev's
  schema has been additive since mid-2026 and is parsed loosely, so an
  added field passes through and a removed one fails the parse and keeps
  the old cache.
- Axle keeps `vendor: "together"`; models.dev's id is `togetherai`, and the
  one mapping lives in the CLI's `catalogHost`. Renaming the vendor would be
  a breaking library change for a cosmetic alignment.
- `splitModelId` is shared between `resolveFirstPartyModel` and the catalog
  so the publisher split has one definition.

## CLI wiring

`resolveContextWindow(endpoint, model, catalog)`: provider `contextWindow`
→ catalog → 200,000, resolved after the definition resolves on every
invocation, logged to the run span with its source, and passed into the
session or batch spec; the runner no longer has a default. A run opens the
cache and fires `refresh()` without awaiting when it is stale; `axle info`
awaits it. The e2e fixture seeds a fresh empty cache in each test home so
no test reaches models.dev. `AXLE_CONTEXT_WINDOW` and the Environment
section of `axle info` are gone.
