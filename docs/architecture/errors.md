# Errors

**Status**: current · **Last design revision**: 2026-10-20 (0.35.0)

This document is normative for how a failure reaches the caller of
`generate()`, `stream()`, `agent.send()`, and the tool loop beneath them:
which failures resolve a result, which reject the handle, and which never
reach the caller at all. Code and tests are built against it; divergence is
a defect. Vocabulary is defined in [terminology.md](../terminology.md).
What a provider does with a request it accepts is in
[provider-content.md](./provider-content.md) and
[provider-tools.md](./provider-tools.md); how a rejected handle interacts
with the agent's queue and continuations is in
[agent-state.md](./agent-state.md).

## Invariants

1. **A send resolves `ok: false` only with what the provider said about
   this request.** The `ok: false` arm of a result carries an
   `AxleProviderFailure`, and every `AxleProviderFailure` is the outcome of
   a request that went out. Its `kind` says what the API did: it did not
   complete the request (`api`), it completed and stopped for a reason that
   is not a usable end (`incomplete`), it completed by declining
   (`refusal`), or it completed and the model's answer is outside the
   Instruct's shape (`parse`). Nothing else is a result.
2. **Everything that is not the provider's answer rejects.** A mistake in
   the caller's setup or in this message, a host file that could not be
   read, a tool that chose to end the run, a cancel, and a broken Axle
   invariant all throw an `AxleError`. The test is one question: could
   Axle have put this on the wire? If not, it throws. A rejection commits
   nothing to the conversation and spends nothing.
3. **The boundary is who answered, not whose fault.** A rejected API key
   is a deterministic configuration mistake, and it resolves `ok: false`
   with `type: "authentication"`, because the provider is the one that
   noticed. Axle does not pre-validate what only the provider can judge.
4. **A vendor module may pre-empt only what it knows for certain.** An
   adapter throws before the request for a feature it has no wire shape
   for on this provider, and a vendor module may also throw for a request
   it knows that vendor rejects. The generic path never guesses: a request
   Axle can shape is sent, and the vendor's answer comes back on the
   result. Each pre-emption is a dated fact in the table below. The same
   mistake never takes both channels on one provider.
5. **Codes are identity; classes are payload.** Every thrown error is an
   `AxleError` with a `code` from `AxleErrorCode`. A subclass exists only
   when the error carries data the host needs to act (`AxleAbortError`,
   `AxleToolFatalError`, `AxleInstructVariableError`). A host matches on
   `code`, or on `instanceof` for a payload class, never on message text.
6. **Tool failures are the model's to handle.** A tool that throws, is not
   found, is called with arguments that do not parse, or reports failure
   from the vendor's side becomes a tool result part and the loop
   continues. The caller sees it in the transcript only. A tool reaches
   the caller by throwing `AxleToolFatalError`, which propagates through
   the loop unchanged; it is the caller's own code refusing to continue,
   not the provider's answer.
7. **A request Axle makes on its own behalf has no result to carry its
   failure.** Compaction's summary request and `decide()`'s decision
   request are not the caller's send. When they fail, the failure is
   rewrapped as a coded `AxleError` and the operation rejects.
8. **An adapter's catch covers the wire, not the build.** Message
   conversion, file resolution, and request assembly run before the
   adapter's try. What that try catches is what the provider or transport
   did, and nothing else is flattened into an `api` failure. A throw that
   escapes the adapter ends the step span and the run span with `error`
   before the handle rejects, the same as a failure result does.

## The three columns

| Axle                    | Provider config                                                                                                           | Provider work                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| An Axle invariant broke | Axle has no wire shape for what was asked, on this provider, or a vendor module knows for certain the request is rejected | The request went out and the API or model answered             |
| throws, `AXLE_ERROR`    | throws, `INVALID_OPTIONS`, `PROVIDER_UNSUPPORTED`, `FILE_UNREADABLE`, or a registry code                                  | `ok: false`, `kind` `api`, `incomplete`, `refusal`, or `parse` |

The host writes two checks, each with one meaning:

```ts
try {
  const result = await agent.send(message);
  if (!result.ok) {
    // the provider's answer: result.error.kind is api | incomplete | refusal | parse
  }
} catch (error) {
  if (!isAxleError(error)) throw error;
  // not the provider's answer: error.code says which
}
```

## Types of failure

Every failure Axle produces is one of eight types. The channel is fixed by
the type.

| Type                     | What it is                                                                                          | Channel                                        | Codes or kinds                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Configuration mistake    | Setup is wrong: an option value, a registry, a definition, a feature this provider has no shape for | rejects                                        | `INVALID_OPTIONS`, `PROVIDER_UNSUPPORTED`, `TOOL_REGISTRY_DUPLICATE`, `SKILL_*`, `COMPACTION_INVALID_MESSAGES` |
| Request content mistake  | This message is malformed: a missing template variable, a content source the adapter cannot map     | rejects                                        | `INSTRUCT_VARIABLE_ERROR`, `PROVIDER_UNSUPPORTED`                                                              |
| Host environment failure | A file on the host could not be resolved: missing, too large, wrong category, no resolver           | rejects                                        | `FILE_UNREADABLE`                                                                                              |
| Provider or wire failure | The request went out and the API did not complete it                                                | `ok: false`                                    | `kind: "api"`                                                                                                  |
| Model output             | The API completed the request and the answer is the problem                                         | `ok: false`, or a tool error                   | `kind: "incomplete"`, `kind: "refusal"`, `kind: "parse"`; `not-found` and `invalid-arguments` tool errors      |
| Tool execution failure   | A tool ran and failed                                                                               | tool error, or rejects when the tool escalates | `execution`, `exception`, `failed` tool errors; `TOOL_FATAL_ERROR`                                             |
| User cancellation        | The signal fired                                                                                    | rejects                                        | `ABORTED`                                                                                                      |
| Internal invariant       | Axle's own assumption broke                                                                         | rejects                                        | `AXLE_ERROR`                                                                                                   |

The first two types share a channel and share codes. The difference between
them is where the caller fixes the mistake, in the setup or in the call,
and the message says which. The caller's handling is the same.

The two `ok: false` types share the result, and the four kinds are cut on
what the API did, because that fixes the host's next move:

| Kind         | What the API did                                                                   | HTTP                                            | `status`                   | `usage`                       | Host's next move                  |
| ------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------- | ----------------------------- | --------------------------------- |
| `api`        | Did not complete the request: rejected it, failed mid-way, or the connection broke | non-2xx, or 2xx with an error event in the body | present when there was one | usually absent                | fix on 4xx, back off on 429 / 5xx |
| `incomplete` | Completed the request and stopped for a reason that is not a usable end            | 2xx                                             | absent                     | present; the call was charged | retry the same request            |
| `refusal`    | Completed the request by declining it or blocking its output                       | 2xx                                             | absent                     | present                       | change the ask; show the user     |
| `parse`      | Completed the request; the model's answer is outside the Instruct's schema         | 2xx                                             | absent                     | present                       | re-ask for shape, or loosen it    |

A stop reason only exists inside a successful response, so the line between
`api` and `incomplete` is not the HTTP status. Once a response streams, the
status is committed at the first byte and anything the API discovers later
travels in the body on a 200: OpenAI's `response.failed`, OpenRouter's
mid-stream upstream error, a Chat Completions `finish_reason: "error"`.
Those are the API failing to complete, so they are `api` with `type` set
and no `status`. A stop reason Axle cannot use is the API completing badly,
so it is `incomplete`. A stream that ends with no completion signal at all
(`IncompleteStream`) could be either and Axle cannot tell; it is
`incomplete` because output may have flowed and the host's move is the
same.

`Length` is not a failure. The model produced output and stopped at a limit
the caller set; the result is `ok: true` with `finishReason: "length"`.

`api` carries `type`, `status`, and `raw` for what the transport or API
said; `incomplete` carries `type` naming the stop reason; `refusal`
carries the provider's `text` and `category`; `parse` carries the
validation `cause` and `stopped` when a loop limit ended the run first. The
result also carries `messages` (or `turn` on the agent), `final`, and
`usage`, which only have content when a request went out. This is the
structural reason the middle column is a throw and not a fifth `kind`: a
build failure would fill every one of those fields with nothing.

## What each provider pre-empts

As of 2026-10-20. Each row is a request the adapter throws
`PROVIDER_UNSUPPORTED` for before any HTTP request, because Axle has no
wire shape for it on that provider or because the vendor module knows the
vendor rejects it. A request not listed here is sent, and the vendor's
answer arrives as `kind: "api"`. The middle column is read from the
adapters, not re-checked against vendor documentation on this date.

| Provider                               | Pre-empted                                                                                                                                                    | Sent and left to the API                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `anthropic()`                          | Non-PDF document files; a tool whose schema is not an object; a content source with no block type                                                             | Any provider tool name; any image or PDF source it has a block for        |
| `openai()`                             | A content source with no part type                                                                                                                            | Any provider tool name; any file or image source it has a part for        |
| `gemini()`                             | Non-PDF document files; `parallelToolCalls: false`; provider tool choice; `toolChoice: "required"` with no function tools; a content source with no part type | Any provider tool name; any file source it has a part for                 |
| `chatCompletions()`, OpenRouter vendor | Provider tool choice; a content source with no part type                                                                                                      | `web_search` (hosted or attached); PDFs and images as OpenAI-shaped parts |
| `chatCompletions()`, Together vendor   | PDF file parts (vendor fact); any provider tool with nothing attached; provider tool choice                                                                   | Images as OpenAI-shaped parts                                             |
| `chatCompletions()`, no vendor         | Any provider tool with nothing attached; provider tool choice; a content source with no part type                                                             | PDFs and images as OpenAI-shaped parts; the vendor decides                |

The Together PDF row is the only pre-emption that is a fact about a vendor
rather than about the protocol. It stays because the message it produces
is readable and the vendor's own 400 is not; it is the vendor module's job
to retire it when Together changes.

A tool choice that names a tool not in the request is `INVALID_OPTIONS` on
every provider, not `PROVIDER_UNSUPPORTED`: it is malformed regardless of
provider.

## What each provider sends as a stop reason

As of 2026-10-20, read from the SDK type definitions and the adapters. Every
value the SDK declares is listed; a value the SDK does not declare reaches
the last row of its table.

Anthropic (`StopReason`, seven values):

| Stop reason                                   | Axle                                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| `end_turn`, `stop_sequence`                   | `ok: true`, `Stop`                                                               |
| `max_tokens`, `model_context_window_exceeded` | `ok: true`, `Length`                                                             |
| `tool_use`                                    | `ok: true`, `FunctionCall`                                                       |
| `pause_turn`                                  | continued transparently; paused blocks and usage are kept and the stream goes on |
| `refusal`                                     | `refusal`                                                                        |
| undeclared                                    | `incomplete`, `type: "FinishReasonError"`                                        |

OpenAI Responses (terminal events):

| Event                                             | Axle                                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `response.completed`                              | `ok: true`, `Stop` or `FunctionCall`                                                                                            |
| `response.incomplete`, reason `max_output_tokens` | `ok: true`, `Length`                                                                                                            |
| `response.incomplete`, reason `content_filter`    | `refusal`, category `content_filter`                                                                                            |
| `response.incomplete`, undeclared reason          | `incomplete`, `type: "RESPONSES_API_INCOMPLETE"`                                                                                |
| `response.failed`                                 | `api`, `type` = the event's error code (`server_error`, `rate_limit_exceeded`, `invalid_prompt`, the image errors), no `status` |

Chat Completions (`finish_reason`, five declared values plus vendor extras):

| Finish reason                                | Axle                                           |
| -------------------------------------------- | ---------------------------------------------- |
| `stop`; `eos` (Together)                     | `ok: true`, `Stop`                             |
| `length`                                     | `ok: true`, `Length`                           |
| `tool_calls`, `function_call`                | `ok: true`, `FunctionCall`                     |
| `content_filter`                             | `refusal`, category `content_filter`           |
| `error` (OpenRouter)                         | `api`, no `status`                             |
| mid-stream upstream error chunk (OpenRouter) | `api`, `type` = the upstream code, no `status` |
| undeclared                                   | `incomplete`, `type: "FinishReasonError"`      |

Gemini (`FinishReason`, nineteen values):

| Finish reason                                                                                                                                 | Axle                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `FINISH_REASON_UNSPECIFIED`                                                                                                                   | not an end; the stream goes on                                         |
| `STOP`                                                                                                                                        | `ok: true`, `Stop`, or `FunctionCall` when the candidate carried calls |
| `MAX_TOKENS`                                                                                                                                  | `ok: true`, `Length`                                                   |
| `SAFETY`, `RECITATION`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII`, `LANGUAGE`, `IMAGE_SAFETY`, `IMAGE_PROHIBITED_CONTENT`, `IMAGE_RECITATION` | `refusal`, category = the reason                                       |
| `MALFORMED_FUNCTION_CALL`, `UNEXPECTED_TOOL_CALL`, `TOO_MANY_TOOL_CALLS`                                                                      | `incomplete`, `type` = the reason                                      |
| `OTHER`, `IMAGE_OTHER`, `NO_IMAGE`, `CONTINUATION`                                                                                            | `incomplete`, `type` = the reason                                      |
| undeclared                                                                                                                                    | `incomplete`, `type: "FinishReasonError"`                              |

Two rows above change behaviour from 0.34.x and are part of this design.
Chat Completions used to map an undeclared finish reason to `Stop`, which
reported a vendor's novel bad stop as success; it now fails like the other
three adapters, and the lenient synonyms (`eos`) are listed by name. Gemini
`LANGUAGE` used to be an unmapped stop reason; it is the model declining,
so it is a refusal.

## Codes

`AxleErrorCode` is a const object; `AxleError.code` is typed as its union.
A subclass declares its code as a literal so a `switch` on `code` narrows
to the subclass.

| Code                           | Thrown when                                                                                                                                                                                                                                                                                                            | `details`                               | Class                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| `INVALID_OPTIONS`              | An option is malformed: a loop limit below 1, a non-integer `maxRetries` or `timeoutMs`, a model id with an unknown publisher or no name, an unsupported reasoning setting, a tool choice naming an absent tool, a tool schema Zod cannot express as JSON Schema, a bad compaction option, a Brave option out of range | none                                    | `AxleError`                             |
| `PROVIDER_UNSUPPORTED`         | A well-formed request Axle has no wire shape for on this provider, or a vendor module pre-empts                                                                                                                                                                                                                        | `{ provider: string, feature: string }` | `AxleError`                             |
| `FILE_UNREADABLE`              | A host file could not be resolved: not found, too large, unsupported type, wrong category, no `fileResolver`                                                                                                                                                                                                           | `{ path?: string, name?: string }`      | `AxleError`                             |
| `TOOL_REGISTRY_DUPLICATE`      | Two tools share a name                                                                                                                                                                                                                                                                                                 | `{ name: string }`                      | `AxleError`                             |
| `SKILL_REGISTRY_DUPLICATE`     | A skill is registered or listed twice                                                                                                                                                                                                                                                                                  | `{ name: string }`                      | `AxleError`                             |
| `SKILL_INVALID`                | `SKILL.md` has bad frontmatter, bad YAML, a schema miss, or a forbidden name                                                                                                                                                                                                                                           | `{ issues? }`                           | `AxleError`                             |
| `SKILL_NOT_FOUND`              | No `SKILL.md` at the root                                                                                                                                                                                                                                                                                              | none                                    | `AxleError`                             |
| `INSTRUCT_VARIABLE_ERROR`      | Template variables not supplied                                                                                                                                                                                                                                                                                        | `{ missingVariables: string[] }`        | `AxleInstructVariableError`             |
| `COMPACTION_INVALID_MESSAGES`  | A compaction callback returned a malformed history                                                                                                                                                                                                                                                                     | per `messages/compaction.ts`            | `AxleError`                             |
| `COMPACTION_GENERATION_FAILED` | Compaction's own summary request resolved `ok: false`                                                                                                                                                                                                                                                                  | none; the failure is `cause`            | `AxleError`                             |
| `COMPACTION_EMPTY_SUMMARY`     | The summariser returned nothing                                                                                                                                                                                                                                                                                        | none                                    | `AxleError`                             |
| `DECISION_REQUEST_FAILED`      | The decision transport failed                                                                                                                                                                                                                                                                                          | `{ status }`                            | `AxleError`                             |
| `DECISION_RESPONSE_INVALID`    | The decision response could not be read                                                                                                                                                                                                                                                                                | none                                    | `AxleError`                             |
| `DECISION_ANSWER_MISMATCH`     | The provider returned the wrong answer type for a question                                                                                                                                                                                                                                                             | `{ key, expected }`                     | `AxleError`                             |
| `AGENT_DEFINITION_INVALID`     | An `AgentDefinition` has an unsupported version, no model, or a resolver that returned no tools or skills                                                                                                                                                                                                              | none                                    | `AxleError`                             |
| `MCP_NOT_CONNECTED`            | An MCP tool is called before `connect()`                                                                                                                                                                                                                                                                               | none                                    | `AxleError`                             |
| `TOOL_FATAL_ERROR`             | A tool threw `AxleToolFatalError` to end the run                                                                                                                                                                                                                                                                       | `{ toolName, usage }`                   | `AxleToolFatalError`                    |
| `ABORTED`                      | The signal fired                                                                                                                                                                                                                                                                                                       | `{ reason, usage }`                     | `AxleAbortError`, `AxleAgentAbortError` |
| `AXLE_ERROR`                   | The default. An Axle invariant broke; nothing the host can act on                                                                                                                                                                                                                                                      | none                                    | `AxleError`                             |

`AxleToolFatalError` carries `toolName`, `messages`, `partial`, and `usage`
as fields. `AxleAbortError` carries `reason`, `messages`, `partial`, and
`usage`; `AxleAgentAbortError` adds `turn`. These are the interruptions of a
request that did go out, so they carry what a result would have carried.
`AxleInstructVariableError` carries `missingVariables`. No other code has a
class.

## Shapes

```ts
type AxleProviderFailure =
  | { kind: "api"; type: string; message: string; status?: number; usage?: Stats; raw?: unknown }
  | { kind: "incomplete"; type: string; message: string; usage?: Stats; raw?: unknown }
  | { kind: "refusal"; message: string; text?: string; category?: string }
  | { kind: "parse"; message: string; cause: unknown };

class AxleError extends Error {
  readonly code: AxleErrorCode;
  readonly id?: string;
  readonly details?: Record<string, unknown>;
  readonly cause?: unknown;
  toJSON(): object;
}

type AnyAxleError =
  AxleAbortError | AxleAgentAbortError | AxleToolFatalError | AxleInstructVariableError | AxleError;
function isAxleError(error: unknown): error is AnyAxleError;
```

`api.type` is `"authentication"` when the provider rejected the
credential, else the provider's own type as recorded in
[provider-content.md](./provider-content.md), else `Undetermined` when the
thrown value could not be read. It is never `"Error"` with no `status`:
that shape was the old signature of a build failure, and build failures
throw. `incomplete.type` is the provider's stop reason verbatim, or one of
Axle's own: `FinishReasonError` for an undeclared stop reason,
`IncompleteStream` for a stream that ended with no completion signal,
`RESPONSES_API_INCOMPLETE` for an undeclared OpenAI incomplete reason.

## Design rationale (2026-10-20)

Before 0.35.0 the same mistake reached a caller three ways. A loop option
out of range threw a coded `AxleError`; a bad `maxRetries` or model id
threw a plain `Error`; and around thirty `throw new Error` sites inside the
four adapters, for features a provider could not do and content sources it
could not map, were caught by the adapter's own try and resolved
`ok: false` with `kind: "model"`, `type: "Error"`, and no status, labelled
the same as a 500 from the API although no request was sent. The reasoning
setting was validated in two places and took a different channel depending
on the provider. A caller had to know which mistakes rejected and which
resolved, and the only way to tell one adapter failure from another was
message text. AXL-89 added a coded error inside an adapter and removed it
again because the catch flattened the code onto `raw.code`.

The agent-state doc already listed "a setup failure" with cancel and fatal
tool error as things that reject the handle, and the library README already
said `ok: false` was model, refusal, and parse only. The provider-tools doc
recorded the opposite for a provider tool nothing serves. The code agreed
with neither consistently.

The fix is a rule, not a mechanism: the result is for the provider's
answer, and a throw is for everything else. It falls out of what the
`ok: false` arm carries (`messages`, `final`, `usage`), none of which exist
before a request is sent. It makes continuations sound, since a
continuation runs on `ok: false` and a setup mistake would otherwise run
the continuation into the same mistake. And it matches what every host in
the repo already writes: an `if (!result.ok)` and a `catch` around it,
which now have one meaning each.

The boundary is drawn at "who answered" rather than "whose fault" because
the alternative would require Axle to pre-validate credentials, quotas, and
vendor capabilities it cannot know. A vendor module is allowed to encode a
vendor fact it is certain of, which means `web_search` on one Chat
Completions vendor may throw and on another may resolve `ok: false`, and
that is accepted: the knowledge lives in one dated table and never in a
runtime probe or message text.

The result's `kind` was `model | refusal | parse` before 0.35.0. `model`
held both the API refusing to complete a request and the API completing
one with a stop reason Axle could not use, which call for different host
moves (fix or back off, versus retry as-is) and differ in whether the call
was charged. It is split into `api` and `incomplete` on the line of what
the API did, and `model` is retired because the API-level failures are the
one case where the model demonstrably did nothing.

Codes rather than classes for identity because a string survives logs,
JSON, the trace writer, and two copies of the package in `node_modules`,
and a class per code explodes. Classes only where there is a payload.

## Rejected alternatives

- **A fourth `kind` on the result for a request Axle could not build**
  (2026-10-20): considered as `kind: "request"` to separate build failures
  from API failures without changing the channel. Rejected because the
  result's other fields would all be empty, a continuation would still run
  on it, and the caller would still need two mechanisms for one class of
  mistake. The distinction the kind would have drawn is the distinction
  between the two channels.
- **Keeping build failures in `kind: "model"` with a code on the failure**
  (2026-10-20): what AXL-89 tried. Rejected because the adapter's catch
  cannot tell a build failure from a wire failure without the error
  carrying a marker, and once it carries one, propagating it is simpler
  than translating it.
- **Rethrowing `AxleError` from the adapter's catch and resolving the rest**
  (2026-10-20): rejected as the mechanism because any plain `Error` a
  future build site throws would silently fall back into `kind: "model"`.
  Moving the build out of the try is structural and does not depend on
  which class a site throws.
- **A class per code** (2026-10-20): rejected; see rationale. `instanceof`
  is kept only for the three classes that carry a payload.
- **Resolving `decide()` and compaction failures as results** (2026-10-20):
  deferred. `decide()` has no result type to carry a failure and giving it
  one is wider than this change. Both are recorded as invariant 7 so the
  rewrap is not mistaken for an inconsistency.
- **Pre-validating credentials so a bad key throws** (2026-10-20): rejected;
  Axle cannot know what a provider will accept, and a probe request is a
  request.
- **Keeping `kind: "model"` as one bucket** (2026-10-20): rejected; see
  rationale. Also rejected: splitting `api` further by cause (rate limit,
  overloaded, context overflow). Beyond `authentication`, which every
  provider signals unambiguously, those need provider knowledge that
  varies by vendor and SDK; `status` is the universal discriminator and
  `withRetry` already keys on it.
- **Folding `incomplete` into `refusal`** (2026-10-20): rejected; a refusal
  is the provider's decision and is never retried verbatim, while an
  incomplete stop is the request failing to finish and is retried as-is.
