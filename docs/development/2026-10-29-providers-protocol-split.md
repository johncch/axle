# Providers become a protocol plus configuration plus an id

Working note for AXL-94, written before implementation. The design it
settled is in [architecture/providers.md](../architecture/providers.md);
this note records how it got there.

## Where it started

AXL-93 (a usage and cost sink) needed to price each usage row, and a row
could not be priced. Its `provider` field held `provider.name`:
`"anthropic"`, `"OpenAI"`, `"Gemini"` or `"ChatCompletions"`. None of these
is a models.dev provider id, and every Chat Completions row said
`"ChatCompletions"` whether it went to OpenRouter, Together or a local
server. The CLI's `catalogHost()` could map an endpoint config to a catalog
id, but the sink never sees endpoint configs.

## Vocabulary first

The word "provider" meant three things in the code (the adapter object,
the `vendor` option, the catalog's `host`), and "host" meant both the
embedding application and the serving business. The vocabulary was fixed
in `terminology.md` before any design:

- model, publisher, protocol, provider, host, each one layer;
- the embedding application is the **consumer**, renamed across the docs,
  JSDoc, `THostEvent` → `TConsumerEvent`, and the CLI's host line → runner
  line;
- an **Endpoint** term was drafted and then dropped once the provider
  object absorbed it.

## How the shape moved

- **Provider id on usage rows.** First proposed as a separate `host` field;
  then as rewriting `model` to `publisher/model` (rejected: the publisher
  is not who billed the request); settled as `AIProvider.id`, which the
  rows already carry under `provider`.
- **What the Agent takes.** `Endpoint` and `Protocol` were both considered
  as the type name. The object is a protocol plus configuration plus
  identity, which is what a provider is, so `AIProvider` stays and the
  `provider:` option keeps its name.
- **`vendor`.** Split into `id` (label) and `dialect` (behavior), because
  most Chat Completions providers need a label and no behavior.
- **Inference.** Dropping hostname inference in favor of presets was
  proposed and reversed: the table is an exact lookup, so it is
  deterministic, and the presets sit on top of it rather than replace it.
- **Layering.** Protocol constructors are the API; presets are conveniences
  and may use only public options. Constructors stay lowercase factory
  functions like the existing ones.
- **Compatibility.** No shims: 0.35.0 breaks `vendor`, `name` and the
  catalog's `host` option, with a migration entry.

## Bedrock

Bedrock was first chosen as the proof provider because the ticket said it
needed SigV4 signing and body deltas. Neither held:

- AWS now issues Bedrock API keys, accepted as the protocol's ordinary key
  on every route.
- The body-delta note describes the older InvokeModel API, not the
  Messages routes.

Live calls in us-east-1 (all `max_tokens` ≤ 200) then changed where Claude
goes:

- Mantle served gpt-oss on both Responses and Chat Completions with the
  key.
- Claude returned 403 on both hostnames until the account's Anthropic
  access was enabled; Sonnet 5.5 and Luna stayed blocked at the account
  level.
- Mantle answered 404 for Sonnet 5.5, a model the console lists, and its
  `/v1/models` showed 7 of the console's 15 Claude models. Runtime knew the
  model.
- Runtime refused the bare `anthropic.claude-haiku-4-5-20251001-v1:0`
  ("on-demand throughput isn't supported") and served
  `global.anthropic.claude-haiku-4-5-20251001-v1:0`, reporting the model
  back without the `global.` prefix.

So `bedrock({ protocol: "messages" })` targets runtime, the other two
protocols target Mantle, and the Bedrock dialect records the requested id
on usage rows, since models.dev prices `us.` 10% above `global.`.

## Model ids against models.dev

A detour checked whether models.dev covers Bedrock: it does, under
runtime's ids, with no Mantle provider and no alias field. LiteLLM models
Mantle separately as `bedrock_mantle`. Of Mantle's 61 listed ids, 48 match
models.dev exactly; 5 more resolve by a unique prefix match in either
direction at a `-` boundary; 8 do not. That lookup rule belongs to AXL-93.

## Plan

1. Seam: `AIProvider` gains `protocol` and `id`, loses `name`; usage rows
   stamp `id`; the catalog's `host` option becomes `provider`.
2. Protocol constructors and dialects; presets rebuilt over them; `vendor`
   removed.
3. `bedrock()` with a wire capture per protocol.
4. CLI: profiles take `protocol` and `id`; `catalogHost()` deleted.
