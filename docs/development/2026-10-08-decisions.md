# Decisions: `decide()` and the TypeSafe provider (AXL-78)

Working note for the first cut of decision-model support in core: the
`decide()` call, the `DecisionProvider` interface, the `typesafe()` provider,
and live checks for both routes to Jev. The OpenAI adapter is not part of
this change.

## Starting point

The ticket said "Support Decision Models — Jev + OpenAI Decisions" and
nothing else. Nothing in the repo mentioned either. Sunnyday already called
TypeSafe through its own small client for two jobs: scoring rubric criteria
and detecting which capabilities an agent's instructions need, each as a
batch of yes/no questions against one document.

The motive, stated partway through: classification steps are going to be
layered into the CLI and possibly Agent, and core is the place where
credentials, retries, and tracing already live. This change is core only.

## What the three vendors expose

Researched on 2026-10-08 from the published references, then confirmed
live for TypeSafe and OpenRouter.

- **TypeSafe** serves `POST /v1/systemone` with `{ model, state, questions }`
  and answers `{ model, answers, usage }`. Questions are a map; each is a
  `noul`, `choice`, or `score` with `instructions` and `criteria`.
- **OpenRouter** exposes Jev two ways with the same body:
  `POST /api/alpha/decisions`, and `POST /api/v1/systemone` for people
  pointing TypeSafe's SDK at it. It adds `id`, `provider`, and `usage.cost`
  to the response, and maps a bare `jev-latest` to its own id.
- **OpenAI** announced a Decisions API at DevDay on 2026-09-29, in limited
  preview, at `POST /v1/decisions`. It asks the same three kinds of question
  with different names: questions are an array with an optional `name`,
  yes/no is `predicate` returning `probability`, choices and levels are
  arrays of objects, and probabilities come back as arrays. It adds two
  things TypeSafe lacks: image input, and a per-question `refusal` answer.

Sunnyday's client turned out to be on an older TypeSafe API
(`/preview/evaluation` with `document`, `prompts`, `responses`, and a
`speed_latest` model). Core targets the current one.

The full comparison is the provider table in
[architecture/decisions.md](../architecture/decisions.md).

## The design conversation

**Is a shared format worth it at all?** The case against: a decision is one
and done. Chat needs a uniform message format because history is replayed
across requests and providers; nothing in a decision is reused, so two
plain clients (`OpenAIDecisions`, `TypesafeDecisions`) would do. The case
for swapping providers in one line is weaker than it sounds, because the
same types do not mean the same numbers: a noul threshold tuned on Jev
would need re-tuning on Luna. What settled it was the layer above. The CLI
and Agent need one question type and one answer type to hold, or every
consumer branches on vendor. And the cost is low, because OpenAI's taxonomy
maps onto TypeSafe's one to one.

**Whose vocabulary?** TypeSafe's. They defined the category, and using
their shape as Axle's shape makes one adapter a passthrough and the other a
rename. `predicate` was considered for the yes/no question and dropped.
The one departure is `input` for TypeSafe's `state`, since "state" already
means agent and session state in Axle.

**Provider interface.** A separate `DecisionProvider` with one method. A
provider implements it, `AIProvider`, or both. `typesafe()` implements only
this one, which makes passing it to an `Agent` a compile error.

**OpenRouter.** The first sketch had a dedicated OpenRouter adapter on the
alpha decisions path. Reading the docs showed the System One path takes the
identical body, so `typesafe()` got a `baseUrl` option and OpenRouter needed
no code. The first live call of the whole feature went through this route,
because an OpenRouter key was on hand before a TypeSafe one.

**Refusal.** Only OpenAI refuses, and only per question. The options were to
put a refusal variant in every answer type now, or to add it (or throw) when
OpenAI lands. Since OpenAI is expected soon and adding the variant later
changes what every consumer narrows on, it went in now.

**OpenAI now or later.** The adapter was sketched (questions map to array,
`noul` to `predicate`, arrays folded back to maps) and three lossy points
identified: noul criteria have no field, the score legend has to be rebuilt
from the question, and the score scale's origin is undocumented. Without
preview access it could only be built against docs, so it waits for the
public release. The installed OpenAI SDK (7.28.0) has no decisions resource;
7.30.1 does.

## What was built

- `packages/axle/src/providers/decide.ts`: the question and answer types,
  the `noul()` / `choice()` / `score()` builders, `DecisionProvider`, and
  `decide()`. Answers are typed per key from literal questions. `decide()`
  throws on failure and on a result that leaves a question unanswered or
  answers it with the wrong type.
- `packages/axle/src/providers/typesafe/`: the provider. Plain `fetch`, a
  strict Zod schema on the response, and the Chat Completions provider's
  `withRetry` for retries and timeouts.
- `checks/`: targets and cases each carry a kind (`chat` or `decision`) and
  a target only runs cases of its kind. Two targets (`typesafe` in the
  default set, `typesafe-openrouter` opt-in) and two cases (`decide-basic`,
  `decide-rejects-unknown-model`).
- Everything public is marked `@experimental`.

## Decisions along the way

- `decide()` takes `span`, like `stream()`, not a tracer. Its span carries
  attributes only; `SpanResult` knows chat and tool shapes and was not
  stretched to fit.
- Instructions and criteria are strings. TypeSafe also accepts JSON for
  both; that can be added without breaking anything.
- OpenRouter's `usage.cost` is dropped. `Stats` has no cost field and
  nothing reports decision spend yet.
- The default timeout is ten seconds per attempt. The first version passed
  none and inherited the chat retry helper's ten minutes, which across
  three attempts is thirty minutes for a call that normally takes well under
  a second. Ten seconds is what TypeSafe's own SDKs use.
- In checks, the OpenRouter target's model is `~typesafe/jev-latest` rather
  than `jev-latest`. The ledger keys rows by model, and two targets on the
  same model string would overwrite each other.
- A check target has exactly one kind. An OpenAI decisions check will be a
  second target beside the chat one, not a target with two kinds.

## Observed live

- TypeSafe direct, `jev-latest`: served by `jev-1.13.0`.
- OpenRouter, `jev-latest` and `~typesafe/jev-latest`: served by
  `typesafe/jev-1.13-20260917`.
- Both reject an unknown model with a 400. TypeSafe's body is
  `{ detail: { error_type, message } }`; OpenRouter's is
  `{ error: { message, code } }`.
- The same ticket and questions gave slightly different numbers on the two
  routes and between runs (a noul of 0.93 and 0.96, for instance).

## Not done

- The OpenAI adapter.
- Any CLI or Agent use of `decide()`.
- TypeSafe's structured instructions and criteria, and image input.
- A cost figure on decision usage.
