# Decisions

**Status**: experimental · **Last design revision**: 2026-10-08 (0.34.0)

This document is normative for `decide()` and decision providers. Code and
tests are built against it; divergence is a defect. Vocabulary is defined in
[terminology.md](../terminology.md). The surface is marked `@experimental`:
the invariants below hold today and may be revised when a second provider
lands.

A decision model answers typed questions about an input instead of
generating text. You send a support ticket and ask "is this a bug?"; you get
back `0.96`, not a sentence.

## Invariants

1. **`decide()` is one request and one result.** No conversation, no
   messages, no tool loop, no streaming, no steps. It takes
   `{ provider, model, input, questions }` and resolves to
   `{ model, answers, usage }`. Nothing it returns is fed back into a later
   call.
2. **Axle's format is TypeSafe's format.** Question types are `noul`
   (yes/no), `choice` (one of a set), and `score` (a position on an ordered
   scale). Request and answer field names and shapes are TypeSafe's System
   One shapes. There is no neutral intermediate format; a provider with a
   different wire shape converts to and from this one inside its adapter.
3. **Questions are a keyed map, and answers come back under the same keys.**
   The key is the caller's name for the question. `decide()` types each
   answer from its question when the questions are written literally: a
   `choice` over `payments` and `frontend` yields a `choice` answer whose
   `choice` is `"payments" | "frontend"`.
4. **Every answer is its own type or a refusal.** `AnswerFor<Q>` is the
   answer type for `Q` or `{ type: "refusal" }`. A refusal belongs to one
   question; the other answers in the same result stand. Callers narrow on
   `type` before reading a value.
5. **`decide()` throws; it does not return a failure result.** A rejected
   request, a transport failure, a timeout, or an abort rejects the promise.
   There is no partial state to hand back, so there is no `ok` flag.
6. **A result that contradicts its questions is an error.** After the
   provider returns, `decide()` checks that every question has an answer of
   its own type or a refusal. A missing or mistyped answer throws
   `AxleError` `DECISION_ANSWER_MISMATCH`. The typed result is therefore
   true at runtime for every provider, including ones written outside this
   repo.
7. **`DecisionProvider` is separate from `AIProvider`.** It has `name` and
   `createDecisionRequest(model, params)`, which returns a promise of
   `{ model, answers, usage }`. A provider may implement either interface or
   both. `typesafe()` implements only this one, so the type system rejects it
   as the `provider` of `stream()`, `generate()`, or an `Agent`.
8. **Instructions and criteria are strings; input may be structured.**
   `input` is a string, a JSON object, or a JSON array. `instructions` and
   each criterion are strings (a choice criterion may be `null`).
9. **Usage is `Stats`.** `in` and `out` are the provider's input and output
   token counts. A provider's dollar cost has no field and is dropped.
10. **Tracing is a child span.** Given `span`, `decide()` opens a child named
    `decide` of type `llm` with `provider`, `model`, and the question count,
    adds the served model and token counts on success, and ends it `ok`,
    `error`, or `cancelled`. The span carries no typed result:
    `SpanResult` describes chat and tool calls.

## Provider requirements

Researched 2026-10-08 from each vendor's published reference, and for
TypeSafe and OpenRouter confirmed against live responses.

|               | TypeSafe                                                                      | OpenRouter                                                               | OpenAI (beta, not implemented)                                                  |
| ------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Endpoint      | `POST /v1/systemone`                                                          | `POST /api/v1/systemone`; also `POST /api/alpha/decisions`               | `POST /v1/decisions`                                                            |
| Model ids     | `jev-latest`, `jev-preview`, `jev-1.13.0`                                     | `typesafe/jev-1.13`, `~typesafe/jev-latest`; bare `jev-latest` is mapped | `gpt-6-luna`                                                                    |
| Input field   | `state`: string, object, or array                                             | same                                                                     | `input`: string, or user messages with text and images                          |
| Input limits  | text only; 64k tokens per request                                             | 32k context                                                              | up to 128 images                                                                |
| Questions     | map keyed by caller's name                                                    | same                                                                     | array; optional `name` per question                                             |
| Yes/no        | `noul`; optional `criteria.true/false`                                        | same                                                                     | `predicate`; no criteria                                                        |
| Choice        | `criteria`: option → description or null; max 255                             | same                                                                     | `choices`: `{ value, description }`; 2–255; value may be boolean                |
| Score         | `criteria`: ordered level descriptions; max 10                                | same                                                                     | `levels`: `{ label, description }`                                              |
| Instructions  | string, object, or array                                                      | same                                                                     | string only                                                                     |
| Yes/no answer | `{ noul }`                                                                    | same                                                                     | `{ probability }`                                                               |
| Choice answer | `choice`, `confidence`, `probabilities` map                                   | same                                                                     | `choice`, `confidence`, `probabilities` array of `{ value, probability }`       |
| Score answer  | `score`, `confidence`, `probabilities` and `legend` maps keyed by level index | same                                                                     | `score`, `confidence`, `probabilities` array of `{ value, label, probability }` |
| Refusal       | none                                                                          | none                                                                     | per question: `{ type: "refusal", name }`                                       |
| Usage         | `input_tokens`, `output_tokens`                                               | adds `cost` (USD); response also adds `id`, `provider`                   | adds cache and reasoning token details                                          |
| Unknown model | 400, `{ detail: { error_type, message } }`                                    | 400, `{ error: { message, code } }`                                      | not observed                                                                    |
| Retryable     | 429, 529                                                                      | 429, 5xx                                                                 | not observed                                                                    |
| SDK timeout   | 10 s per attempt                                                              | —                                                                        | —                                                                               |

## Axle's translation

**`typesafe(apiKey, options)`** sends `{ model, state: input, questions }` to
`${baseUrl}/v1/systemone` with a bearer token. The questions go out exactly
as the caller built them. The response is parsed against a strict schema of
the TypeSafe column above; extra fields are ignored, and a body that does not
match throws `DECISION_RESPONSE_INVALID`. A non-2xx response throws
`DECISION_REQUEST_FAILED` with the status and body in `details`. Usage maps
`input_tokens` to `in` and `output_tokens` to `out`.

- `baseUrl` defaults to `https://api.typesafe.ai`. Setting it to
  `https://openrouter.ai/api` with an OpenRouter key reaches Jev through
  OpenRouter's System One path. There is no OpenRouter-specific code.
- `timeoutMs` defaults to 10,000 per attempt, matching TypeSafe's SDKs.
  `maxRetries` defaults to 2. Retries and backoff are the Chat Completions
  provider's `withRetry`: 408, 409, 429, and 5xx are retried, honouring
  `retry-after`.
- The model id is passed through unchanged.

**OpenAI** is not implemented. When it is, its adapter converts in both
directions: the questions map becomes an array with each key as `name`,
`noul` becomes `predicate`, criteria become `choices` and `levels`, and the
answer arrays fold back into maps. Three points are not a rename and must be
settled against real responses: `noul` criteria have no field, the score
legend must be rebuilt from the question, and the score scale's origin is
undocumented.

## Design rationale (2026-10-08)

The work exists to let the CLI and Agent layer classification steps on the
same credential, retry, and tracing layer as chat calls (AXL-78). That
purpose decided the shape. A layer that runs classification steps needs one
question type and one answer type to hold; with a client per vendor, every
consumer would branch on vendor. So there is a shared format even though a
decision call, unlike a chat call, has no message history to keep portable.

Swapping providers is not the benefit. The types are the same across
providers but the numbers are not: each model has its own calibration, and a
threshold tuned on one (keep a capability when its noul is at least 0.6)
must be re-tuned on another.

TypeSafe's shape is the format because TypeSafe defined the category and
OpenAI's API asks the same three kinds of question with renamed fields.
Adopting it makes one adapter a passthrough and the other a rename, with no
third vocabulary to maintain.

A separate provider interface follows from what the vendors offer. TypeSafe
has no chat API and OpenAI has both. One interface with an optional method
would let a caller pass `typesafe()` to an `Agent` and fail at runtime.

Refusal is in the answer types from the start although only OpenAI produces
it. Adding it later would change the type every consumer narrows on.

## Rejected alternatives

- **One client per vendor, no shared format** (2026-10-08): the simplest
  thing, and defensible since nothing is reused across calls. Rejected
  because the CLI and Agent layers would each branch on vendor.
- **A neutral format neither vendor uses** (2026-10-08): two converters
  instead of one, and a third vocabulary, for no gain while the two vendors'
  taxonomies map one to one.
- **`predicate` instead of `noul`** (2026-10-08): plainer English, but it is
  the copy's word. TypeSafe coined the terms and Axle follows the source.
- **A decision method on `AIProvider`** (2026-10-08): makes chat-only and
  decision-only providers indistinguishable to the type checker.
- **Decisions on `chatCompletions()` for OpenRouter** (2026-10-08): the call
  is not a Chat Completions call, and the other vendors behind that factory
  cannot serve it.
- **An OpenRouter-specific provider on `/api/alpha/decisions`** (2026-10-08):
  the body is identical to System One and OpenRouter serves that path too, so
  a `baseUrl` covers it. Costs `session_id`, provider routing, and trace
  fields, which are documented only on the alpha path; revisit if they are
  needed.
- **Returning `{ ok: false, error }` like `stream()`** (2026-10-08): that
  shape exists to carry partial messages and usage out of a failed loop. A
  single request has neither.
- **Throwing on any refusal** (2026-10-08): keeps the answer types clean but
  discards the answers that did come back in the same request.
- **Structured instructions and criteria** (2026-10-08): TypeSafe accepts
  JSON for both. Deferred, not rejected: strings cover every current use and
  widening later breaks nothing.
- **The chat retry default of ten minutes per attempt** (2026-10-08):
  inherited by accident at first. A decision call answers in well under a
  second, and a hung one would have stalled its caller for thirty minutes.
