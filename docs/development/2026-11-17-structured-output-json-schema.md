# Structured output as JSON Schema (AXL-108)

**Date**: 2026-11-17 · **Release**: 0.37.0 · **Normative doc**:
[structured-output.md](../architecture/structured-output.md)

A working note for the change that made JSON Schema the format of an
`Instruct` schema. It records how the design was reached, including one
design that was built and thrown away the same day.

## Where it started

The goal was provider-native structured output, which takes a JSON Schema.
Two tickets stood in front of it: AXL-108, to define one subset of Zod that
Axle would accept and make an `Instruct` serializable, and AXL-52, to send
the schema natively. AXL-108 had an agreed subset and six open decisions.

## The subset, built and discarded

The first pass built the agreed subset as a walker over Zod's internal
definitions: object root, every key required, `.nullable()` for a missing
value, closed objects, no recursion, and no `.refine()`, `z.coerce`,
`.transform()` or `.default()`. It passed its tests and was reset.

What turned it over was a run of questions about what the subset was for:

- **Do providers accept any JSON Schema?** No, and their subsets conflict.
  OpenAI's strict mode requires every key and rejects `.optional()`;
  Anthropic accepts optional keys and rejects `.min()`. The walker allowed
  `.min()` and banned recursion, so it matched neither.
- **What does Zod do with what it cannot convert?** It throws on some
  (`z.date()`), converts most, and silently drops `.refine()` and
  `z.coerce`. The silent drops only matter if something other than the
  holder of the Zod object validates the answer.
- **Does Zod cross the wire?** No. Only JSON Schema can, and
  `z.fromJSONSchema()` rebuilds something that is not the original.
- **Is prompt output a subset of native?** As implemented, yes, but only
  because the example builder knew eight types. Without the example, prompt
  output accepts anything that converts.

Each answer removed a reason for Axle to hold an opinion about schema
content. What was left was a pass-through.

## The design that replaced it

1. Drop the example. Put the JSON Schema in the prompt.
2. Accept a JSON Schema, or any Standard Schema object, and reach the
   library only through `~standard`. Zod callers change nothing.
3. Store the schema on the user message. `stream()` asks the provider
   whether it takes a schema natively and applies it either way.
4. Send the `Instruct` over the wire as data. The served side renders; the
   client validates.

Three points were settled in conversation and are easy to get wrong later:

- **The instructions are not in the stored message, and the schema is.** An
  earlier draft dropped the instructions from history altogether, which
  would have broken prompt caching and left a later request with a JSON
  answer and no visible reason. Storing the schema and regenerating the text
  keeps both.
- **The `Instruct` goes into `stream()`; the message is still built at
  `send()`.** The user turn is announced when a send is queued, so the
  message cannot wait for `stream()`. Its text does not depend on the
  provider, so it does not need to.
- **Parsing is two steps with two owners.** `JSON.parse` runs wherever the
  answer arrives. Validation runs only where the schema object is.

## Found along the way

- `z.email()`, `z.uuid()` and `z.iso.datetime()` are not
  `instanceof z.ZodString`, so the old example builder threw on them.
- The object `z.toJSONSchema()` returns carries a hidden `~standard`
  property with a validator. `toJsonSchema()` copies the schema's own keys
  so a converted schema behaves the same in process and across a wire.
- `Agent | RemoteAgent` as a union does not resolve the overloaded `send`
  for an `Instruct<JsonSchema>`. A host that holds the union narrows first.

## Checked against live providers

The `instruct-json` checks, nine cases each, passed on first attempt with
the schema in the prompt on `gpt-6-luna`, `gpt-5.6-luna`,
`claude-haiku-5-5`, `claude-haiku-4-5`, `gemini-flash-lite-latest`,
`gemini-3.8-flash`, `GLM-5.3-Flash` and `DeepSeek-V4.1-Flash` (Together AI
and OpenRouter). The ledger had the same cases passing with the example, so
this showed no regression. The local Ollama model was not run.

## Left for later

- Native requests per protocol, and which Chat Completions presets declare
  them.
- Whether to strip value constraints from the native schema.
- Repair on validation failure.
