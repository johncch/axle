# Providers

**Status**: accepted, being implemented for 0.35.0 (AXL-94) · **Last design revision**: 2026-10-29

This document is normative for what a provider is, how one is built from a
protocol, and what each provider needs on the wire. Code and tests are built
against it; divergence is a defect. Vocabulary (model, publisher, protocol,
provider, host) is defined in [terminology.md](../terminology.md). What a
provider does with provider tools is in [provider-tools.md](./provider-tools.md);
what content it returns is in [provider-content.md](./provider-content.md).

## Invariants

1. **A provider is a protocol plus configuration plus an id.** The
   `AIProvider` an `Agent` takes carries `protocol` (the wire format it
   speaks) and `id` (the models.dev id of the service it reaches, absent
   when unknown). The configuration (base URL, auth, dialect) is captured
   at construction and not exposed.

   ```ts
   interface AIProvider {
     readonly protocol: "messages" | "responses" | "generateContent" | "chatCompletions";
     readonly id?: string;
     tools?: ExecutableTool[];
     /** @internal */
     createStreamingRequest(model, params): AsyncGenerator<AnyStreamChunk>;
   }
   ```

2. **Protocol constructors are the API; presets are shorthand.** Each
   protocol has a constructor of the same name taking a base URL:
   `messages()`, `responses()`, `generateContent()`, `chatCompletions()`.
   A preset (`anthropic()`, `openrouter()`, `bedrock()`) is a one-liner over
   a protocol constructor using **only public options**. No preset has a
   private hook; anything a preset does, a consumer can write.
3. **One adapter per protocol.** A provider that differs from the protocol's
   reference behavior expresses the difference as a dialect, a typed object
   per protocol (`ChatCompletionsDialect`, `MessagesDialect`). Supporting a
   new provider never forks an adapter. Dialects are exported so consumers
   can compose them.
4. **`id` is a label; it changes nothing on the wire.** It is stamped on
   every `UsageEntry` the provider's requests produce, so a consumer can
   price usage and look up context windows. A provider with no `id` works
   the same; its rows are unpriced.
5. **Explicit wins, then the hostname table, then nothing.** When `id` or
   `dialect` is omitted, the protocol constructor looks up the base URL's
   hostname in a fixed table (exact match, no network, no pattern). Each
   field is resolved on its own: passing `id` does not suppress an inferred
   dialect. A hostname not in the table yields neither.
6. **The base URL keeps each protocol's SDK convention.** The SDK appends
   its own path, so the base URL differs by protocol (table below). A
   provider that serves several protocols has a base URL per protocol.
7. **The model id passes through as the provider spells it.** No prefix is
   added or stripped on the way out, except where a preset's dialect says
   so: the first-party presets accept their publisher prefix and strip it
   (`anthropic/`, `openai/`, `gemini/` or `google/`). A dialect may say
   which id a usage row records: the one the response reported (default)
   or the one requested (Bedrock, below).
8. **Auth is the protocol SDK's own.** `apiKey` is sent the way the SDK
   sends it (`x-api-key` for Messages, `Authorization: Bearer` for
   Responses and Chat Completions, `x-goog-api-key` for generateContent).
   Auth that must be computed per request is a `fetch` wrapper; there is no
   separate auth abstraction.

## Protocols

| Constructor         | SDK                 | Base URL convention                           | Presets                                   |
| ------------------- | ------------------- | --------------------------------------------- | ----------------------------------------- |
| `messages()`        | `@anthropic-ai/sdk` | origin; SDK appends `/v1/messages`            | `anthropic()`, `bedrock()`                |
| `responses()`       | `openai`            | includes version; SDK appends `/responses`    | `openai()`, `bedrock()`                   |
| `generateContent()` | `@google/genai`     | origin; SDK appends `/v1beta/models/…`        | `gemini()`                                |
| `chatCompletions()` | Axle's own `fetch`  | includes version; appends `/chat/completions` | `openrouter()`, `together()`, `bedrock()` |

`typesafe()` is a `DecisionProvider` on its own wire format (System One), not
one of these protocols. It carries an `id` and is otherwise out of scope.

## Presets

| Preset         | Protocol        | Base URL                                                   | `id`             | Dialect    |
| -------------- | --------------- | ---------------------------------------------------------- | ---------------- | ---------- |
| `anthropic()`  | messages        | `https://api.anthropic.com`                                | `anthropic`      | anthropic  |
| `openai()`     | responses       | `https://api.openai.com/v1`                                | `openai`         | openai     |
| `gemini()`     | generateContent | `https://generativelanguage.googleapis.com`                | `google`         | google     |
| `openrouter()` | chatCompletions | `https://openrouter.ai/api/v1`                             | `openrouter`     | openrouter |
| `together()`   | chatCompletions | `https://api.together.xyz/v1`                              | `togetherai`     | together   |
| `bedrock()`    | messages        | `https://bedrock-runtime.{region}.amazonaws.com/anthropic` | `amazon-bedrock` | bedrock    |
| `bedrock()`    | responses       | `https://bedrock-mantle.{region}.api.aws/v1`               | `amazon-bedrock` | none       |
| `bedrock()`    | chatCompletions | `https://bedrock-mantle.{region}.api.aws/v1`               | `amazon-bedrock` | none       |

`bedrock()` takes `protocol` because the model decides which one it speaks
(below). The other presets speak one.

## Hostname table

| Hostname            | `id`         | Dialect    |
| ------------------- | ------------ | ---------- |
| `openrouter.ai`     | `openrouter` | openrouter |
| `api.openrouter.ai` | `openrouter` | openrouter |
| `api.together.xyz`  | `togetherai` | together   |
| `api.together.ai`   | `togetherai` | together   |

A label-only row (an `id` with no dialect) costs nothing and gets that
provider's usage priced. Bedrock is not in the table: its hostnames vary by
region and it needs `bedrock()` to choose a base URL per protocol.

## Provider requirements

### Amazon Bedrock

Researched 2026-10-29 against AWS's docs and live calls in us-east-1 with a
long-term Bedrock API key. Bedrock has two hostnames: **runtime**
(`bedrock-runtime.{region}.amazonaws.com`, the full model catalog) and
**Mantle** (`bedrock-mantle.{region}.api.aws`, OpenAI- and
Anthropic-compatible routes for a subset of models). Both bill as
`amazon-bedrock`.

| Route                            | Protocol        | Bedrock requires                                                                                                                        | Axle sends                                                     | Evidence (2026-10-29)                                                                                                                                                                                                                    |
| -------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| runtime `/anthropic/v1/messages` | messages        | API key in `x-api-key`; inference-profile ids (`global.…`, `us.…`) for current Claude models; the bare `anthropic.…-v1:0` id is refused | the requested id unchanged; usage rows record the requested id | `global.anthropic.claude-haiku-4-5-20251001-v1:0`: 200, response `model` reported **without** the `global.` prefix; bare id: 400 "on-demand throughput isn't supported"; Mantle-style alias `anthropic.claude-haiku-4-5`: 400 invalid id |
| Mantle `/anthropic/v1/messages`  | messages        | API key in `x-api-key`; Mantle aliases (`anthropic.claude-haiku-4-5`); serves a subset of Claude                                        | not used: `bedrock()` sends Claude to runtime                  | `anthropic.claude-sonnet-5-5`: 404 "does not exist" while runtime knows it; `/v1/models` lists 7 of the console's 15 Claude models                                                                                                       |
| Mantle `/v1/responses`           | responses       | API key as Bearer; per model: gpt-oss and GPT-5.x serve it                                                                              | standard Responses request                                     | `openai.gpt-oss-20b`: 200, reported id as requested, usage with `reasoning_tokens`                                                                                                                                                       |
| Mantle `/v1/chat/completions`    | chatCompletions | API key as Bearer; most non-Claude models; GPT-5.x reportedly Responses only                                                            | standard Chat Completions request                              | `openai.gpt-oss-20b`: 200, reported id as requested, no reasoning breakdown in usage                                                                                                                                                     |

Usage rows on the runtime Messages route record the **requested** id because
the price depends on the inference-profile prefix and the response drops it:
in models.dev, `us.`/`eu.`/`jp.`/`au.`/`in.` are 10% above `global.` and the
bare id. Whether a `us.` request also reports the bare id is unconfirmed;
recording the requested id is right either way.

models.dev's `amazon-bedrock` ids are runtime's. Of the 61 ids Mantle's
`/v1/models` listed, 48 match a models.dev id exactly; pricing the rest is
the model catalog's concern, not the provider's.

## Rejected alternatives

- **`Endpoint` as a separate type and term** (2026-10-29): a protocol
  instance configured with a base URL, auth and dialect already is the
  thing that reaches a service. A second object between protocol and
  provider named nothing a consumer holds.
- **Naming the type `Protocol`** (2026-10-29): the instance carries
  configuration and identity, not just a wire format. It would read
  `protocol.protocol` and make `anthropic(key)` look like a wire format.
- **Renaming `AIProvider` to `Provider`** (2026-10-29): consumers already use
  `Provider` for other things (React context providers).
- **Encoding the provider in the model id (`publisher/model`)**
  (2026-10-29): the publisher names who made the model, not who billed the
  request. `deepseek/deepseek-chat` is served by DeepSeek, OpenRouter and
  Together at three prices; only the provider knows which.
- **One `vendor` option for label and behavior** (2026-10-29): the pre-0.35
  shape. Most Chat Completions providers need a label and no dialect
  (Groq, Fireworks); one field forced a vendor value that changed nothing.
- **Explicit `id` and `dialect` only, no inference** (2026-10-29): the
  hostname table is an exact lookup with no network and no fuzziness, so
  it never surprises anyone who knows it exists. Kept.
- **A deprecated `vendor` shim** (2026-10-29): breaking is acceptable for
  0.35.0; the migration entry maps each value to a preset.
- **SigV4 request signing as Bedrock's auth** (2026-10-29): the ticket's
  first assumption. Bedrock API keys work on every route as the protocol's
  normal API key. Signing raw IAM credentials remains possible through
  `fetch`.
- **Claude through Mantle** (2026-10-29): Mantle serves a subset of Claude
  and uses aliases models.dev does not list. Runtime serves the full
  catalog under models.dev's ids.
- **A separate `amazon-bedrock-mantle` provider id** (2026-10-29): LiteLLM
  models Mantle as its own provider, but models.dev files both hostnames
  under `amazon-bedrock` and newer models share one id across them.
