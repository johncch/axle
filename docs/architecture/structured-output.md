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
   library's own error from `Instruct.validate()` and `toMessage()`.
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
9. **`stream()` writes the schema into the prompt.** The request's copy of
   every user message that carries a schema gets an "Output Format
   Instructions" block written ahead of its first text part: one sentence
   asking for JSON matching the schema and nothing else, then the JSON
   Schema, indented by two spaces. The stored messages are not changed. It
   is done again on every step of the send. Axle builds no example value.
10. **The prompt is stable across requests.** The block is generated from
    the stored schema the same way each time, for earlier sends too, so an
    earlier request stays a prefix of a later one and the model still sees
    why an earlier answer was JSON.
11. **The schema is not sent to the provider as a request field.** Axle
    uses no provider's native structured output (see Native output, tried
    and left out). A caller who wants it sends the provider's field through
    `providerOptions`; the prompt block is still written.
12. **`stream()` parses, with the `Instruct` it was given.** Parsing
    (invariant 5) happens in `stream()` for a direct call and for the
    Agent alike: the Agent builds the user message at `send()`, because the
    user turn is announced then, and hands `stream()` both that message and
    the `Instruct` it came from. A `stream()` call with messages and no
    `Instruct` applies a message's schema and returns no `response`.
13. **The schema is recorded on both turns.** A user turn carries
    `output: { schema }`, copied from its message. The agent turn that
    answers it carries the same on `turn:end`, which marks the turn's text
    as a structured answer for a reader that never held the schema.

14. **An `Instruct` crosses the wire as data, and each side does what it
    can.** `toJSON()` gives the prompt template, inputs, references, context
    sections, files, metadata and the schema as JSON Schema;
    `Instruct.fromJSON()` rebuilds it. A rebuilt Instruct holds a JSON
    Schema object, so the served side stops at `JSON.parse` (invariant 5)
    and the client, which holds the Standard Schema object, validates
    (remote-agent.md invariant 6). Inputs are strings, numbers, booleans or
    `null` so that they render the same on both sides.
15. **A converted schema is plain data.** `toJsonSchema()` returns a copy
    with only the JSON Schema's own keys. Zod's converter attaches a hidden
    `~standard` property, with a validator, to the object it returns;
    without the copy a schema would validate in the process that converted
    it and not after crossing a wire.

## Design rationale (2026-11-17)

The work began as a way to reach providers' native structured output,
which takes a JSON Schema. Native output was tried and left out (below);
what remained is a cleanup of the prompt path and a serializable `Instruct`.
The earlier implementation had three faults: the schema was a live Zod object that only the calling process
could use; a served agent never saw it, though it is the side that talks to
the provider; and an example builder that understood eight Zod types
decided what a schema could contain.

Making JSON Schema the format removes all three. It is data, so it reaches
a provider, a wire and a stored turn unchanged. Zod stays for what it is
good at, typing the result and checking it, on the one side that holds the
object.

Axle keeps no opinion about schema content because nothing downstream
needs one. The schema reaches the model as text, which any model can read,
and the answer is checked by the library that wrote the schema.

Refinements and coercion are dropped silently when Zod converts to JSON
Schema. That is harmless here because the object that holds them also
checks the answer (invariant 5).

## Native output, tried and left out (2026-11-17)

Every provider has a request field that takes a JSON Schema and constrains
the answer to it. Sending the schema there was built for Responses,
generateContent and Chat Completions, run against the live providers, and
removed. It worked cleanly on one of five, and the prompt path already
passed every structured-output check on all of them. Each statement below
comes from those runs.

**OpenAI.** Strict mode, which is also what applies when `strict` is left
out, requires `additionalProperties: false` on every object and every key
in `required`. The input side of a `z.object()` has neither, so strict
rejected every schema tried. With `strict: false` all were accepted and
answered correctly, with and without tools. Strict would guarantee a
conforming answer, but the library checks the answer anyway (invariant 5),
and a schema that fails before the model runs is worse than one that is
checked after.

**Anthropic.** `output_config.format` has no non-strict form. It answered
400 to every schema from a plain `z.object()`, because each object must
state `additionalProperties: false`, and to `minimum`, `maximum` and
`oneOf`. It accepted `z.strictObject()` schemas, optional keys included.
Declaring it would turn sends that work on the prompt path into errors.

**Gemini.** `responseJsonSchema` took every schema, bounds and unions
included, and every case without tools passed. In a send that had to call
a tool once and then answer, `gemini-flash-lite-latest` called it more than
once in 7 of 29 runs. On the prompt path the same send passed 12 of 12.

**Together AI.** `response_format` took every schema and every case
without tools passed on two models. With a tool on the request,
`DeepSeek-V4.1-Flash` wrote the JSON answer at once and never called the
tool, and `GLM-5.3-Flash` did not finish.

**OpenRouter.** It passes `response_format` to whichever upstream serves
the model. On `deepseek-v4.1-flash` one answer in three came back with
empty arrays, answers were padded with whitespace, and one request never
finished. The same cases pass on the prompt path.

The failures with tools share a cause where it could be seen: the
constraint applies to everything the model writes, and on these hosts a
tool call is something the model writes. Native output was designed for a
single request that returns one object, and an agent's requests carry
tools.

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
  choosing native or prompt. Rejected: there is one path.
- **Output instructions stored in the message text** (2026-11-17): what
  `render()` did before, so the instructions were part of the conversation
  and of the user turn. Rejected: a transcript should show what the
  user wrote. The schema is stored instead and the text regenerated from it
  (invariant 10).
- **Announcing the user message after `stream()` starts** (2026-11-17), so
  the Agent need not build the message before `stream()` does. Rejected: a
  queued send's message would not appear until its turn came, which is what
  pending turns exist to prevent, and the message's text does not depend on
  the provider.
- **Native output on OpenAI alone** (2026-11-17): Responses with
  `strict: false`, the one combination that passed. Built and removed the
  same day. Rejected: one provider behaving differently from the rest, and
  a provider flag, a request field and a recorded mode to carry it, for no
  failure it fixed.
- **Native output only for a request with no tools** (2026-11-17), for the
  providers that failed with tools. Rejected for the same reason.
