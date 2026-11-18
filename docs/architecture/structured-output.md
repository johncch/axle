# Structured output

**Status**: current · **Last design revision**: 2026-11-17 (0.37.0, JSON Schema is the format)

This document is normative for how an `Instruct` describes the answer it
wants and how Axle reads that answer back: what a schema is, what Axle does
with it, and what it leaves to the schema library and the provider. Code and
tests are built against it; divergence is a defect.

## Invariants

1. **The format is JSON Schema.** `OutputSchema` is a JSON Schema object, or
   a Standard Schema object that converts to one. Everything Axle does with
   a schema after it is given (storing it on the message and the turn,
   sending it to a provider, writing it into the prompt) is done with the
   JSON Schema. A schema library is a way to write one.
2. **A schema library is reached through `~standard` only.** Axle calls
   `~standard.jsonSchema.input({ target: "draft-2020-12" })` for the JSON
   Schema and `~standard.validate()` to check the answer, as
   [Standard Schema and Standard JSON Schema](https://standardschema.dev)
   define them. It imports no schema library for this, so Zod 4.2 and later,
   ArkType and any other implementer are equal. A `~standard` object with no
   `jsonSchema` converter is `INVALID_OPTIONS`.
3. **The JSON Schema is the schema's input side.** The model writes what the
   schema takes in, not what it gives out. A transform therefore appears as
   the type it accepts, and a key with a default is not required.
4. **Axle defines no subset.** It does not inspect a schema, reject a
   keyword or rewrite one. A schema the library cannot convert throws the
   library's own error from `Instruct.validate()` and `toMessage()`. A
   schema a provider cannot accept is the provider's failure. The same
   `Instruct` can therefore work on one provider and fail on another.
5. **The answer is JSON, then the library's verdict.** The final assistant
   message's text is stripped of one surrounding markdown fence and passed
   to `JSON.parse`. With a Standard Schema object, `validate()` then runs
   and its value is the response, so refinements, transforms and defaults
   apply and the response has the schema's output type. With a JSON Schema
   object nothing more runs: the response is the parsed JSON, typed
   `unknown`. Axle validates against a JSON Schema nowhere.
6. **Parsing waits.** `validate()` may answer with a promise, so
   `parseResponse()` and `Instruct.parse()` return one.
7. **A bad answer is a `parse` failure.** Text that is not JSON, and a value
   the library rejects, both resolve `ok: false` with `error.kind: "parse"`
   (errors.md). The message for a rejected value names each issue's path.
   There is no retry and no repair.
8. **The schema lives on the user message.** `Instruct.toMessage()` puts
   the JSON Schema on the message as `output: { schema }`. The message's
   text is the clean prompt: `render()` returns the prompt, references and
   context sections and never the schema, so neither the stored
   conversation nor the user turn shows output instructions. The schema is
   scoped to its message. It is not a conversation setting.
9. **`stream()` applies the schema, by one of two paths.** Before the first
   request it reads the schema of the last user message and asks the
   provider once whether it takes one natively (`AIProvider.structuredOutput`).
   - **Native output:** the schema goes to the provider as
     `ProviderStreamParams.output`, and the messages are sent as stored.
     Earlier messages' schemas are not sent.
   - **Prompt output:** the request's copy of every user message that
     carries a schema gets an "Output Format Instructions" block written
     ahead of its first text part: one sentence asking for JSON matching the
     schema and nothing else, then the JSON Schema, indented by two spaces.
     The stored messages are not changed.

   Either way it is done again on every step of the send. Axle builds no
   example value.

10. **Prompt output is stable across requests.** The block is generated
    from the stored schema the same way each time, for earlier sends too,
    so an earlier request stays a prefix of a later one and the model still
    sees why an earlier answer was JSON.
11. **The caller does not choose the path, and a provider's refusal of a
    schema is final.** There is no mode option. A provider error on a schema
    surfaces as that error and never triggers a second attempt on the other
    path.
12. **`stream()` parses, with the `Instruct` it was given.** Parsing
    (invariant 5) happens in `stream()` for a direct call and for the
    Agent alike: the Agent builds the user message at `send()`, because the
    user turn is announced then, and hands `stream()` both that message and
    the `Instruct` it came from. A `stream()` call with messages and no
    `Instruct` applies a message's schema and returns no `response`.
13. **The path and the schema are recorded.** The stream's span carries
    `outputMode`. A user turn carries `output: { schema }`, copied from its
    message. An agent turn's `turn:end` carries `output: { schema, mode }`,
    which marks the turn's text as a structured answer for a reader that
    never held the schema.

## Planned (AXL-108)

Settled on 2026-11-17 and not yet built. Each moves into Invariants in the
change that builds it.

- **Native support is declared by the protocol**, and per preset for Chat
  Completions. There is no registry by model. No provider declares it yet,
  so every send takes the prompt path.
- **An `Instruct` crosses the wire as data**, its schema as JSON Schema. The
  served agent holds a JSON Schema object, so it stops at `JSON.parse`
  (invariant 5) and the client, which holds the Standard Schema object,
  validates. This reverses remote-agent.md invariant 6. Until then a
  `RemoteAgent` writes the prompt-output block ahead of the rendered prompt
  itself, so a served agent receives text and no schema.
- **`providerOptions` still wins.** It is applied last and replaces whole
  top-level fields, so a caller's `output_config` on Anthropic replaces the
  schema with it.

## Design rationale (2026-11-17)

The feature exists to reach providers' native structured output, which
takes a JSON Schema. Three things in the earlier implementation stood in
the way: the schema was a live Zod object that only the calling process
could use; a served agent never saw it, though it is the side that talks to
the provider; and an example builder that understood eight Zod types
decided what a schema could contain.

Making JSON Schema the format removes all three. It is data, so it reaches
a provider, a wire and a stored turn unchanged. Zod stays for what it is
good at, typing the result and checking it, on the one side that holds the
object.

Axle keeps no opinion about schema content because any opinion would be a
third rule set between two that already exist. The providers' accepted
subsets conflict with each other: OpenAI's strict mode requires every key
and rejects `oneOf`; Anthropic accepts optional keys and rejects length and
numeric bounds. No subset of Axle's matches both, and a provider's own
error is more accurate than a prediction of it.

Refinements and coercion are dropped silently when Zod converts to JSON
Schema. That is harmless here because the object that holds them also
checks the answer (invariant 5).

## Rejected alternatives

- **An Axle-defined subset of Zod** (2026-11-17): an object root, every key
  required with `.nullable()` for a missing value, closed objects, no
  recursion, and no `.refine()`, `z.coerce`, `.transform()` or `.default()`,
  enforced by a walker over the Zod schema. Built and discarded the same
  day. Rejected: it banned most of what Zod adds, threw at runtime on
  schemas that compiled, and read Zod's internals to do it. It matched no
  provider: it allowed `.min()`, which Anthropic rejects, and banned
  recursion, which OpenAI accepts. Its ban on behaviour was only needed if
  something other than the holder of the Zod object validated the answer,
  and nothing does.
- **Building an example from the schema** (2026-11-17): the earlier
  `zodToExample` put a sample object with placeholder values in the prompt.
  Rejected: its type coverage was the real limit on what a schema could
  contain, the placeholder values carried no information, and value
  constraints never reached the model at all.
- **Rebuilding a validator on the served side** (2026-11-17): with
  `z.fromJSONSchema()`, so a served agent could validate. Rejected: Zod
  marks it experimental, and the rebuilt schema is not the original. It
  rejected an extra key that the original `z.object()` strips, so the two
  sides would disagree about the same answer.
- **A different schema library** (2026-11-17): TypeBox, whose schemas are
  JSON Schema objects. Rejected as a replacement: tools and the MCP adapter
  take Zod, and it would break every caller for the one gain of validating
  on the served side, which is not wanted. A TypeBox schema is a JSON
  Schema object and is accepted as one.
- **A caller-facing output mode** (2026-11-11): an `outputMode` option
  choosing native or prompt. Rejected: the prompt path is the normal path
  for a protocol without native support, and the caller has nothing to
  decide.
- **Output instructions stored in the message text** (2026-11-17): what
  `render()` did before, so the instructions were part of the conversation
  and of the user turn. Rejected: the path is only known when `stream()`
  asks the provider, native output has no text to store, and a transcript
  should show what the user wrote. The schema is stored instead and the
  text regenerated from it (invariant 10).
- **Announcing the user message after `stream()` starts** (2026-11-17), so
  the Agent need not build the message before `stream()` does. Rejected: a
  queued send's message would not appear until its turn came, which is what
  pending turns exist to prevent, and the message's text does not depend on
  the provider.
- **Stripping value constraints from the native schema** (open): AXL-108
  records it as undecided. Until it is decided, invariant 4 holds.
