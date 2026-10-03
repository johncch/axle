# Provider content

**Status**: current · **Researched**: 2026-10-01 (`@anthropic-ai/sdk` 0.129.0, `openai` 7.25.0, `@google/genai` 2.24.0)

This document lists every kind of content each provider can return, what
Axle stores it as, and whether Axle sends it back on later requests. It
exists so a gap is visible before it is hit. It is normative for the
mappings it records: a change that alters one updates the row in the same
diff, and a new SDK version or provider feature that adds a kind of content
adds a row. Thinking content has its own document,
[thinking.md](thinking.md); rows here point to it rather than repeat it.

Each row comes from reading the adapter and the message converter, the
installed SDK's types, and the provider's documentation on the research
date. Rows were not run against a live API unless the row says so.

## How to read the tables

An assistant message in Axle holds six kinds of part: `text`, `thinking`,
`tool-call`, `provider-tool`, `provider-tool-result`, and `citation`.
Anything a provider returns that does not become one of these is dropped
when the response is stored. It is then missing from the conversation
history and is never sent back.

| Column            | Meaning                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Content           | The provider's own name for the block, item, or field                                                                                         |
| Stored as         | The Axle part it becomes, or "dropped"                                                                                                        |
| Sent back         | "as received" (the provider's object, untouched), "rebuilt" (reconstructed from the Axle part), or "no"                                       |
| Provider requires | What the provider's docs or SDK say about sending it back. "Not checked" means no source was read; "not stated" means the source says nothing |
| Owner             | The ticket that owns a gap, "accepted" for a known limitation, "untriaged" for a gap with no decision yet, "—" when nothing is lost           |

## Anthropic (Messages API)

Axle calls `client.messages.create` with `stream: true`. Content blocks are
the SDK's `ContentBlock` union.

| Content                                                                                                                                                                                 | Stored as                                                                                                                                                                                                                                                                                                                                                                                | Sent back                                                                    | Provider requires                                                                                                                                                                                                                                                                                                                                   | Owner                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `text`                                                                                                                                                                                  | `text` part; its `citations` are normalized onto the part                                                                                                                                                                                                                                                                                                                                | Rebuilt: text plus its Anthropic citations, without the response's `file_id` | "Send the assistant's content blocks back exactly as you received them"; a citation's `encrypted_index` "must be passed back for multi-turn conversations". Observed on 2026-10-01 (AXL-64, `claude-haiku-4-5`): a follow-up request is accepted with or without the citations                                                                      | —                                                                                                                         |
| `thinking`, `redacted_thinking`                                                                                                                                                         | `thinking` part                                                                                                                                                                                                                                                                                                                                                                          | Rebuilt                                                                      | See [thinking.md](thinking.md)                                                                                                                                                                                                                                                                                                                      | —                                                                                                                         |
| `tool_use`                                                                                                                                                                              | `tool-call` part (id, name, parsed input)                                                                                                                                                                                                                                                                                                                                                | Rebuilt                                                                      | Each `tool_use` needs a `tool_result` in the next message                                                                                                                                                                                                                                                                                           | `caller` and `toolset_name` are not stored: AXL-71                                                                        |
| `server_tool_use`                                                                                                                                                                       | `provider-tool` part: `name`, normalized `input`, and the whole block as `continuity.call`                                                                                                                                                                                                                                                                                               | As received                                                                  | Later requests must define the same tool; a call that has not run yet runs at the start of the next request                                                                                                                                                                                                                                         | —                                                                                                                         |
| `web_search_tool_result`, `web_fetch_tool_result`, `code_execution_tool_result`, `bash_code_execution_tool_result`, `text_editor_code_execution_tool_result`, `tool_search_tool_result` | `continuity.result` of the `provider-tool` part with the matching id, and its `result` (`success`, or `error` when `content` has an `error_code`). A code or bash result's `stdout`, `stderr` and `return_code` become the result's `output` as `{ stdout, stderr?, exitCode }`. When the call is in an earlier message, a `provider-tool-result` part in the position the block arrived | As received                                                                  | Search results: "If `encrypted_content` is missing or modified, the request fails with a 400 validation error". A result that arrives in a later response stays there: "keep the whole exchange in your `messages` array in order". Observed on 2026-10-01 (AXL-65, `claude-haiku-4-5`): a later request without that result is rejected with a 400 | —                                                                                                                         |
| `container_upload`                                                                                                                                                                      | Dropped                                                                                                                                                                                                                                                                                                                                                                                  | No                                                                           | Not checked. The bash and code results also list written files as `file_id` entries in their `content`                                                                                                                                                                                                                                              | Untriaged: produced by code execution, which Axle maps since 2026-10-03; the README states Axle has no multi-modal output |
| Beta-only blocks: `mcp_tool_use`, `mcp_tool_result`, `mcp_tool_listing`, `compaction`, `advisor_tool_result`, `fallback`                                                                | Dropped                                                                                                                                                                                                                                                                                                                                                                                  | No                                                                           | Not checked                                                                                                                                                                                                                                                                                                                                         | Accepted: Axle calls the non-beta endpoint, whose union has none of these                                                 |

`code_execution` maps to `code_execution_20260521`. From `20260120` on,
Anthropic reports code execution as sub-tools: `bash_code_execution` with a
`command`, and `text_editor_code_execution` with a `view`, `create` or
`str_replace` action. Each is a `server_tool_use` block under that name, so
each becomes its own `provider-tool` part, the bash call with a `command`
input and the text editor call with none. Their results are
`bash_code_execution_tool_result`, whose content carries `stdout`, `stderr`
and `return_code`, and `text_editor_code_execution_tool_result`. Observed on
2026-10-03 (`claude-haiku-4-5`): asked to write and run a script, Claude sent
a `create` then a bash run, and a follow-up that echoed both pairs was
accepted. Code called from the container, through `allowed_callers`, arrives
as ordinary `tool_use` or `server_tool_use` blocks with a `caller`; the
caller survives in continuity and is not otherwise stored (AXL-71).

Within one paused turn (`stop_reason: "pause_turn"`), the adapter sends
every block of the paused response back as received, whatever its type. The
table describes later requests, which are built from the stored message.

When Claude calls a server tool and a client tool in the same response,
Anthropic does not run the server tool. The response ends with
`stop_reason: "tool_use"` and holds the `server_tool_use` block with no
result. The tool runs at the start of the next request, and its result is the
first block of the next response. Axle stores the two halves where they
arrived:

| Message               | Parts                                                     |
| --------------------- | --------------------------------------------------------- |
| Assistant, first step | `provider-tool` with `input` and no `result`; `tool-call` |
| Tool                  | The client tool results                                   |
| Assistant, next step  | `provider-tool-result` with the same `id`; then the rest  |

The result block names its call by id but not by tool name. Before each
request the Anthropic provider reads the conversation for `provider-tool`
parts that have no `result` and no later `provider-tool-result`, and gives
their ids and names to the adapter. A result block that matches none of them
is dropped. `provider-tool:complete` fires in the step the result arrives
in, with the id of the original call.

A turn that stops between the two steps (`maxSteps`, `stop()`, a fatal tool
error) leaves a `provider-tool` part that never gets a result. Anthropic's
docs say a later user message is then rejected. Axle does not repair this.

Response-level state:

| Content                                  | Stored as                                                                                                             | Sent back | Provider requires                                                                                                                                      | Owner                                                                                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `container` (`id`, `expires_at`)         | Dropped                                                                                                               | No        | "Each request runs in a new container unless you pass an earlier response's container ID back." A request naming an expired container returns an error | Accepted: only carries code execution state. Observed on 2026-10-01 (AXL-51, `claude-sonnet-5-5`): a follow-up without it is accepted |
| `stop_reason: "pause_turn"`              | Not stored; the adapter continues the turn                                                                            | —         | "Pass the paused response back as-is"; include the same tools                                                                                          | —                                                                                                                                     |
| `stop_reason: "refusal"`, `stop_details` | Not stored; a [refusal](#refusals) carrying `category` and `explanation`. The refused response's blocks are discarded | No        | "Treat any partial output as incomplete and discard it." Continuing "without resetting will result in continued refusals"                              | —                                                                                                                                     |

## OpenAI (Responses API)

Axle calls `client.responses.stream`. It sets none of `store`,
`previous_response_id`, or `include`, so every request carries the whole
conversation as input items. Output items are the SDK's `ResponseOutputItem`
union.

| Content                                                                                                                                                                                                                                                                                                         | Stored as                                                                                                                                      | Sent back                                                                                  | Provider requires                                                                                                                                                                                                                                                                            | Owner                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `message` with `output_text`                                                                                                                                                                                                                                                                                    | One `text` part per text content part; `annotations` normalized into `citations`; the item's `phase` kept in `providerMetadata`                | Rebuilt: each run of adjacent text with the same `phase` as one `{ role, content, phase }` | "Preserve every item in the response's `output` array." `phase`: "preserve and resend phase on all assistant messages — dropping it can degrade performance"                                                                                                                                 | The item `id` and annotations are not sent back: AXL-71 |
| `message` with `refusal`                                                                                                                                                                                                                                                                                        | Not stored; a [refusal](#refusals) carrying the refusal text                                                                                   | No                                                                                         | Not checked                                                                                                                                                                                                                                                                                  | —                                                       |
| `reasoning`                                                                                                                                                                                                                                                                                                     | `thinking` part; `encrypted_content` is taken from `response.output_item.done`                                                                 | Rebuilt, only when `encrypted_content` was captured                                        | "We highly recommend you pass back any reasoning items returned with the last function call." The SDK says the `encrypted_content` on `output_item.added` "may be incomplete". Observed on 2026-10-01 (`gpt-6-luna`): the two values differ, and a follow-up request is accepted with either | —                                                       |
| `function_call`                                                                                                                                                                                                                                                                                                 | `tool-call` part (`call_id` as id, name, parsed arguments)                                                                                     | Rebuilt, without the item `id`                                                             | "Ensure all items between the last user message and your function call output are passed into the next response untouched"                                                                                                                                                                   | —                                                       |
| `web_search_call`, `file_search_call`, `code_interpreter_call`                                                                                                                                                                                                                                                  | `provider-tool` part: Axle's `name`, normalized `input`, `result` (`error` when `status` is `failed`), and the whole item as `continuity.item` | As received                                                                                | Same "preserve every item" rule. A search that followed a reasoning item needs that item directly before it                                                                                                                                                                                  | —                                                       |
| Everything else: `image_generation_call`, `mcp_call`, `mcp_list_tools`, `mcp_approval_request`, `mcp_approval_response`, `computer_call`, `local_shell_call`, `shell_call`, `apply_patch_call`, `custom_tool_call`, `tool_search_call`, `compaction`, `program`, `additional_tools`, and their `*_output` items | Dropped; the stream events are logged as unhandled                                                                                             | No                                                                                         | Same "preserve every item" rule                                                                                                                                                                                                                                                              | Accepted: Axle has no portable name for these tools     |

Items are sent back in the order OpenAI returned them, because the stored
parts keep that order and the converter walks them in sequence. OpenAI
requires it: a `reasoning` item must sit directly before the
`web_search_call` it led to. Observed on 2026-10-01 (AXL-51, `gpt-6-luna`):
a request that carried the reasoning item, but with another item between it
and its search, was rejected with "Item ... of type 'web_search_call' was
provided without its required 'reasoning' item". Text parts with nothing sent
between them are joined into one message item.

Response-level state:

| Content                                       | Stored as                                                                                                                                 | Sent back            | Provider requires                                                                                                                                                                                                                                                                          | Owner |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| `response.id`                                 | The assistant message `id`                                                                                                                | No                   | Only needed for `previous_response_id`, which Axle does not use                                                                                                                                                                                                                            | —     |
| Code interpreter `outputs`                    | The `logs` entries joined as the result's `output` string; the whole array stays inside the stored item. `image` entries are not surfaced | As part of that item | Returned only when the request lists `code_interpreter_call.outputs` in `include`. Observed on 2026-10-03 (AXL-68, `gpt-6-luna`): `outputs` is `null` without it and a `logs` entry with the stdout with it. Axle adds the include whenever a provider tool resolves to `code_interpreter` | —     |
| Code interpreter `container_id`               | Kept inside the stored `code_interpreter_call` item                                                                                       | As part of that item | Auto mode "reuses an active container that was used by a previous `code_interpreter_call` item in the model's context". "A container expires if it is not used for 20 minutes"                                                                                                             | —     |
| `incomplete_details` on `response.incomplete` | `max_output_tokens`: `finishReason: "length"`. `content_filter`: a [refusal](#refusals). Any other reason: a model error naming it        | No                   | Not checked                                                                                                                                                                                                                                                                                | —     |

## Gemini (`generateContent`)

Axle calls `client.models.generateContentStream`. Google's current guides
describe the newer Interactions API; the rows below were checked against the
`generate-content/` guides and the SDK's `Part` type. Content arrives as
fields on a `Part`.

| Content                                          | Stored as                                                                                                                                                                                                     | Sent back                                   | Provider requires                                                                                                                                                                                                                                                                                                                                                     | Owner                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `text`                                           | `text` part                                                                                                                                                                                                   | Rebuilt                                     | —                                                                                                                                                                                                                                                                                                                                                                     | —                                                                                                                           |
| `text` with `thought: true`                      | `thinking` part                                                                                                                                                                                               | Rebuilt                                     | See [thinking.md](thinking.md)                                                                                                                                                                                                                                                                                                                                        | —                                                                                                                           |
| `thoughtSignature` on a part with empty text     | `thinking` part holding only the signature                                                                                                                                                                    | Rebuilt                                     | See [thinking.md](thinking.md)                                                                                                                                                                                                                                                                                                                                        | —                                                                                                                           |
| `functionCall`                                   | `tool-call` part; its `thoughtSignature` in `providerMetadata`                                                                                                                                                | Rebuilt, with the signature                 | Gemini 3: "you must pass back thought signatures during function calling, otherwise you will get a validation error"                                                                                                                                                                                                                                                  | —                                                                                                                           |
| `thoughtSignature` on a part with non-empty text | Dropped; the adapter reads the signature only on empty-text, function-call and executable-code parts                                                                                                          | No                                          | "The final content part (text, inlineData…) returned by the model may contain a thought_signature." Returning it "is recommended". Not observed on 2026-10-03 (AXL-68, `gemini-3-flash-preview`): the final signature arrived on its own empty-text part, after the text                                                                                              | Accepted until observed. The converter would echo `providerMetadata.thoughtSignature` on a text part, but nothing writes it |
| `executableCode`, `codeExecutionResult`          | `provider-tool` part named `code_execution`: `input` is `{ type: "code", code }`, `result` is `success` with the `output` string, or `error` from `outcome`, and both parts as received in `continuity.parts` | As received, in source order among the text | "You must pass back the id and thought_signature fields for tool combination to work". Observed on 2026-10-03 (AXL-68, `gemini-3-flash-preview`): the code part carries `id` and `thoughtSignature`, the result part the same `id`; a follow-up that echoes both is accepted and answers from the output. On `gemini-2.5-flash` neither part has an id or a signature | —                                                                                                                           |
| `toolCall`, `toolResponse`                       | Dropped; logged as an unhandled part                                                                                                                                                                          | No                                          | SDK: "The client is expected to echo this message back to the API". Not observed on 2026-10-03 (AXL-68, `gemini-3-flash-preview`), with code execution alone or combined with a client function and `includeServerSideToolInvocations` on: the built-in tool still arrives as `executableCode` and `codeExecutionResult`                                              | Accepted until observed                                                                                                     |
| `inlineData`, `fileData`                         | Dropped; logged as an unhandled part                                                                                                                                                                          | No                                          | Not checked                                                                                                                                                                                                                                                                                                                                                           | Accepted: the README states Axle has no multi-modal output                                                                  |

Fields on the candidate, outside its parts:

| Content                                                         | Stored as                                            | Sent back | Provider requires                                                                                        | Owner    |
| --------------------------------------------------------------- | ---------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------- | -------- |
| `groundingMetadata.groundingChunks` with `groundingSupports`    | `citations` on the text part they point at           | No        | Not stated                                                                                               | —        |
| `groundingMetadata.searchEntryPoint`                            | Dropped                                              | No        | "Contains the HTML and CSS to render the required Search Suggestions." A display rule, not a replay rule | Accepted |
| `groundingMetadata.webSearchQueries`                            | `input` of a `provider-tool` part named `web_search` | No        | Not stated                                                                                               | —        |
| `citationMetadata`                                              | `citations` on the last text part                    | No        | Not checked                                                                                              | —        |
| `urlContextMetadata`                                            | Dropped                                              | No        | Not checked                                                                                              | Accepted |
| `finishReason` that reports blocked output, and `finishMessage` | Not stored; a [refusal](#refusals)                   | No        | Not checked                                                                                              | —        |

A blocked prompt arrives outside the candidates, as
`promptFeedback.blockReason`. It is a [refusal](#refusals) too.

Code execution arrives as two parts. The `executableCode` part opens the
`provider-tool` part and fires `provider-tool:start` and
`provider-tool:input`; the `codeExecutionResult` part closes it and fires
`provider-tool:complete`, or `provider-tool:error` when `outcome` is not
`OUTCOME_OK`. The parts are paired on their `id`; when the result has none
it closes the most recent open call. The part's `id` is the code part's `id`,
or the response id with `:code_execution:<index>` appended when Gemini gives
none. The stdout is in `continuity.parts[1].codeExecutionResult.output`.

Combining a built-in tool with client functions needs
`toolConfig.includeServerSideToolInvocations: true`; without it Gemini 3
rejects the request with "Please enable
tool_config.include_server_side_tool_invocations to use Built-in tools with
Function calling". Axle sets it whenever a request carries both kinds of
tool. Gemini 2.5 refuses the combination either way ("Tool call context
circulation is not enabled for models/gemini-2.5-flash"). Both observed on
2026-10-03 (AXL-68).

Google Search returns no part of its own. Axle builds a `provider-tool`
part from `groundingMetadata.webSearchQueries`: `name` is `web_search`,
`input` is `{ type: "search", queries }`, `result` is `success`, and there is
no `continuity` because Gemini needs nothing back. Observed on 2026-10-02
(`gemini-flash-lite-latest`): the queries arrive only in the last chunk,
together with the finish reason, so the part follows the text and its events
fire when the answer ends. The id is the response id with `:web_search`
appended, since Gemini gives the search none.

## Chat Completions (generic, OpenRouter, Together)

Axle speaks the wire format directly, with its own types in
`providers/chatcompletions/types.ts`. A field those types do not list is
ignored.

| Content                                           | Stored as                                                                 | Sent back                                   | Provider requires                         | Owner    |
| ------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------- | -------- |
| `content`                                         | `text` part                                                               | Rebuilt: all text joined into one `content` | Not checked                               | —        |
| `tool_calls`                                      | `tool-call` part                                                          | Rebuilt                                     | Not checked                               | —        |
| `reasoning_details` (OpenRouter)                  | `thinking` parts with continuity                                          | Rebuilt, for the `openrouter` vendor only   | See [thinking.md](thinking.md)            | —        |
| `reasoning`, `reasoning_content`                  | `thinking` part                                                           | No                                          | See [thinking.md](thinking.md)            | —        |
| `annotations` of type `url_citation`              | `citations` on the open text part, or a `citation` part when not anchored | No                                          | OpenRouter's web search guide: not stated | —        |
| `annotations` of any other type                   | Dropped                                                                   | No                                          | Not checked                               | Accepted |
| `refusal`, and `finish_reason: "content_filter"`  | Not stored; a [refusal](#refusals)                                        | No                                          | Not checked                               | —        |
| Fields outside Axle's wire types, such as `audio` | Dropped                                                                   | No                                          | Not checked                               | Accepted |

OpenRouter's `openrouter:web_search` server tool reports its results as
`url_citation` annotations, so it too produces no `provider-tool` part.
Accepted.

## Shape of provider tool parts

The rule for provider data on a part (decided 2026-10-02, AXL-51):

1. A field that a turn reads is normalized: one Axle shape on every
   provider, with no cast and no provider check in the shared path.
2. Everything else sits in a provider-specific container on the part.
3. Top-level fields translate directly between providers. The container does
   not, and a part whose container belongs to another provider is left out
   of the request. Switching providers mid-conversation loses those calls;
   that is accepted.

For provider tools, a turn reads the name, what the tool was asked to do, and
how it ended. Those are `name`, `input`, and `result`. The provider's own
objects are in `continuity`, tagged by provider like `ThinkingContinuity`.

| Field        | Anthropic                                                                                                                    | OpenAI                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`       | The block's `name`, unchanged                                                                                                | `web_search_call` → `web_search`, `code_interpreter_call` → `code_execution`, `file_search_call` → `file_search`                                 |
| `input`      | `web_search` `{ query }` → `search`; `web_fetch` `{ url }` → `open`; `code_execution` `{ code }` → `code`; other tools: none | Web search `action`: `search`, `open_page` → `open`, `find_in_page` → `find`; code interpreter `code` → `code`; file search `queries` → `search` |
| `result`     | `error` when the result block's `content` has an `error_code`, else `success`                                                | `error` when the item's `status` is `failed`, else `success`                                                                                     |
| `continuity` | `{ provider: "anthropic", call, result? }`: the `server_tool_use` block and its result block                                 | `{ provider: "openai", item }`: the output item                                                                                                  |

Gemini's search part has `name`, `input`, and `result` and no `continuity`;
see the Gemini section.

The adapters do the normalizing. The step reader, the stream events, and the
turn builder carry `name`, `input`, and `result` and never the provider's
objects. Each converter sends a part back only when its `continuity` has
that provider's tag, and sends the stored objects unchanged.

`continuity` is the one place Axle's provider-neutral types refer to SDK
types (`messages/providerTool.ts`). The Anthropic SDK types a server tool's
`input` as `unknown`; the adapter reads `query`, `url`, and `code` from it
through its own small interface.

An Anthropic call nested in code execution (dynamic filtering) arrives with
its input complete on the block and no JSON deltas, and carries a `caller`.
Both are kept because the whole block is stored.

Rejected: provider-shaped `input` and `output` at the top level, typed with
a union of SDK types (tried first on 2026-10-02). It removed the casts but
made a renderer check the provider before reading a query, and it put
provider shapes on stream and turn events. Rejected: normalized search
results on `result`. Nothing renders them, OpenAI returns none by default,
and citations already carry the sources that were used.

## Failed provider tools

How each provider reports a failed provider tool, and what Axle does with
it (researched 2026-10-02):

| Provider   | Failure signal                                                                                                  | Axle                                                | Evidence                                                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Anthropic  | The result block's `content` is `{ type: "<tool>_tool_result_error", error_code }`; the response is still a 200 | `provider-tool:error` with `error_code` as the type | Observed live: web search `max_uses_exceeded`, web fetch `url_not_allowed` (`claude-haiku-4-5`). The SDK has six such types, all named this way |
| OpenAI     | The tool item's `status` is `failed`; no error code                                                             | `provider-tool:error` with type `failed`            | SDK types only. A search for, and a fetch of, a domain that does not exist both came back `completed` (`gpt-6-luna`)                            |
| Gemini     | None: `groundingMetadata` has no status field                                                                   | Nothing to report                                   | SDK types                                                                                                                                       |
| OpenRouter | None: over its `max_uses` the search "return[s] a message telling the model the limit was hit"                  | Nothing to report                                   | Observed live: a stream past `max_uses: 1` held only content, reasoning, and annotations (`deepseek/deepseek-v4.1-flash`)                       |

The Anthropic adapter recognises a failure by the `error_code` field on the
result's `content`, which only the six error types carry. It does not list
their type names, so a server tool Anthropic adds later is covered if its
error has that field.

## How a response ends

Every value each provider can end a response with, and what Axle returns.
"Finish reason" is `finishReason` on the stored assistant message, with
`ok: true`. A failure is `ok: false` and stores no message for that step.

Anthropic, `stop_reason`:

| Value                           | Meaning                                                                                                                                             | Axle                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `end_turn`                      | The model finished                                                                                                                                  | Finish reason `stop`                                  |
| `stop_sequence`                 | A caller-supplied stop sequence was produced                                                                                                        | Finish reason `stop`                                  |
| `max_tokens`                    | The request's output cap was reached                                                                                                                | Finish reason `length`                                |
| `model_context_window_exceeded` | The context window filled before the output cap. "The response is still valid but was limited by context window"; "treat the response as truncated" | Finish reason `length`                                |
| `tool_use`                      | The model called a client tool                                                                                                                      | Finish reason `function_call`; the loop runs the tool |
| `pause_turn`                    | Anthropic's own tool loop hit its iteration limit                                                                                                   | Not surfaced; the adapter continues the turn          |
| `refusal`                       | The request was declined                                                                                                                            | [Refusal](#refusals)                                  |
| Any other value                 | —                                                                                                                                                   | Model error `FinishReasonError`                       |

OpenAI Responses, the terminal stream event:

| Event                                                     | Meaning                                                    | Axle                                                                                                                            |
| --------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `response.completed`                                      | The response finished                                      | Finish reason `function_call` when it holds a function call, else `stop`. A [refusal](#refusals) when it holds a `refusal` part |
| `response.incomplete`, reason `max_output_tokens`         | The output cap was reached                                 | Finish reason `length`                                                                                                          |
| `response.incomplete`, reason `content_filter`            | Output was blocked                                         | [Refusal](#refusals)                                                                                                            |
| `response.incomplete`, reason `max_messages` or `steered` | Not observed; the SDK ties `steered` to WebSocket steering | Model error `RESPONSES_API_INCOMPLETE`                                                                                          |
| `response.failed`                                         | The response failed                                        | Model error with OpenAI's `code`                                                                                                |
| No terminal event                                         | The stream was cut                                         | Model error `IncompleteStream`                                                                                                  |

Gemini, `finishReason` on the candidate:

| Value                                                                                                                             | Meaning                                            | Axle                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `STOP`                                                                                                                            | The model finished, or produced a stop sequence    | Finish reason `stop`, or `function_call` when the response holds a function call |
| `MAX_TOKENS`                                                                                                                      | The output cap was reached                         | Finish reason `length`                                                           |
| `SAFETY`, `RECITATION`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII`, `IMAGE_SAFETY`, `IMAGE_PROHIBITED_CONTENT`, `IMAGE_RECITATION` | Output was blocked                                 | [Refusal](#refusals)                                                             |
| `LANGUAGE`, `OTHER`, `MALFORMED_FUNCTION_CALL`, `UNEXPECTED_TOOL_CALL`, `TOO_MANY_TOOL_CALLS`, `NO_IMAGE`, `IMAGE_OTHER`          | The model stopped for a reason that is not a block | Model error `FinishReasonError`                                                  |
| `FINISH_REASON_UNSPECIFIED`                                                                                                       | Still streaming                                    | Ignored                                                                          |

A Gemini response that holds a function call finishes as `function_call`
whatever its `finishReason` is. A blocked prompt has no candidate; it arrives
as `promptFeedback.blockReason` and is a refusal.

Chat Completions, `finish_reason`:

| Value                                                | Sent by            | Axle                                           |
| ---------------------------------------------------- | ------------------ | ---------------------------------------------- |
| `stop`                                               | All                | Finish reason `stop`                           |
| `eos`                                                | Together           | Finish reason `stop`                           |
| `length`                                             | All                | Finish reason `length`                         |
| `tool_calls`, `function_call`                        | All                | Finish reason `function_call`                  |
| `content_filter`                                     | OpenAI, OpenRouter | [Refusal](#refusals)                           |
| `error` with a top-level `error` object on the chunk | OpenRouter         | Model error with the upstream code and message |
| `error` with no `error` object                       | OpenRouter         | Model error `FinishReasonError`                |
| Any other value                                      | —                  | Finish reason `stop`                           |

OpenRouter normalizes every model's reason to `tool_calls`, `stop`, `length`,
`content_filter`, or `error`, and reports the model's own string as
`native_finish_reason`, which Axle does not read.

A finish reason is always `stop`, `length`, or `function_call`; `cancelled`
is set only on the partial message of an aborted stream. A stop reason Axle
does not know (any Anthropic value not in its table, or an OpenRouter
`error` finish without an error object) fails the step as a model error
rather than returning content under an unknown ending. An unknown Chat
Completions reason is read as `stop`, because OpenAI-compatible vendors add
reasons of their own. Rejected (2026-10-02): keeping `AxleStopReason.Error`
for these; it put a message in the conversation that no caller could tell
from an answer without a second check.

## Refusals

A refusal is a provider declining a request, or blocking its output, through
a signal on the response. Axle reports every one the same way: the step
fails, and `generate()`, `stream().final`, and `agent.send().final` resolve
`ok: false` with `error: { kind: "refusal", message, text?, category? }`.

| Provider         | Signal                                                                                                                                                                                    | `text`                     | `category`              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------- |
| Anthropic        | `stop_reason: "refusal"`                                                                                                                                                                  | `stop_details.explanation` | `stop_details.category` |
| OpenAI           | A `refusal` content part, read from `response.refusal.done`                                                                                                                               | The refusal text           | —                       |
| OpenAI           | `response.incomplete` with reason `content_filter`                                                                                                                                        | —                          | `content_filter`        |
| Gemini           | `promptFeedback.blockReason`                                                                                                                                                              | `blockReasonMessage`       | The block reason        |
| Gemini           | A candidate `finishReason` of `SAFETY`, `RECITATION`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII`, `IMAGE_SAFETY`, `IMAGE_PROHIBITED_CONTENT`, or `IMAGE_RECITATION`, with no function call | `finishMessage`            | The finish reason       |
| Chat Completions | `delta.refusal`                                                                                                                                                                           | The accumulated text       | —                       |
| Chat Completions | `finish_reason: "content_filter"`                                                                                                                                                         | —                          | `content_filter`        |

Either field is absent when the provider gave none; Anthropic documents
`null` for both as a normal value. `message` is the text, or
`Request refused: <category>`, or `Request refused`.

Invariants:

1. A refusal is never `ok: true`. An `Instruct` call returns the refusal,
   not a parse failure.
2. The refused step is not stored. `messages` holds only the steps that
   completed before it, text that streamed before a mid-stream refusal is
   not kept, and `step:complete` does not fire. The stream's last event is
   `error` with the same failure.
3. Usage the provider reported with the refusal is counted.
4. Because nothing is stored, the next request needs no refusal-specific
   conversion. After a refused `agent.send()` the history ends with the
   user message, as it does after a model error.

None of these signals has been observed live. The Anthropic rows follow the
refusals guide and the SDK's `RefusalStopDetails`; the others follow the SDK
types. Tried on 2026-10-02: Anthropic's documented test string was answered
as ordinary text (`claude-haiku-4-5`, `claude-sonnet-5-5`), and a structured
output request that asked the model to decline was answered with JSON
(`gpt-6-luna`). One neighbouring event was observed the same day: a response
cut off at `max_output_tokens` ends with `response.incomplete`, not
`response.completed` (`gpt-6-luna`).

Not covered:

- A refusal the model writes as ordinary text. No provider marks it, so it
  is a normal `ok: true` answer.
- Anthropic says a conversation must drop or rephrase the refused turn, or
  move to another model, before continuing. Axle leaves the user message in
  place; the caller decides.
- `stop_details.recommended_model`, the fallback credit token, and Gemini's
  `safetyRatings` are dropped.

Rejected (2026-10-02): `ok: true` with a `refusal` finish reason. A caller
that checks only `ok` would still take the refusal for an answer, which is
the defect this replaces. Rejected: storing the refused message with a
`refusal` part. Anthropic and Gemini return nothing to send back, Anthropic
says to discard what did arrive, and a seventh part type would need a
send-back rule on every provider for content no provider requires.

## Request failures

A request the provider rejects outright, or a transport failure, is
`ok: false` with `error: { kind: "model", type, message, status?, usage?, raw? }`.
`type` is `"authentication"` when the provider rejected the credential. For
every other failure it is the provider's own type: the SDK error class name
for Anthropic, OpenAI, and Gemini; for a Chat Completions response, the
body's `error.type`, else its `error.code` as a string, else the status as a
string; an upstream `code` for a mid-stream OpenRouter error; or one of
Axle's own (`FinishReasonError`, `IncompleteStream`,
`RESPONSES_API_INCOMPLETE`). `status` is the HTTP status when there was one,
and `raw` is what the provider threw.

A Chat Completions non-2xx body is parsed as JSON. When it holds an `error`
object in the OpenAI shape (`{ error: { type?, code?, message? } }`), that
object supplies `type` and `message`, and `raw.body` is the parsed body. Any
other body (HTML from a proxy, empty, JSON without `error`) gives
`type: "<status>"`, a message of `HTTP error! status: <status> - <text>`, and
`raw.body` as text. OpenRouter sets a numeric `code` equal to the status and
no `type`, so its `type` is the status string either way; its `message` is
the readable one. `withRetry` decides on the status before the body is read,
so parsing changes nothing about retries.

| Provider         | A rejected key arrives as                                                                                          | `status` | `type`                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------ |
| Anthropic        | SDK `AuthenticationError`, `status: 401`; the class leaves `name` as `Error`                                       | `401`    | `authentication`                                                         |
| OpenAI           | SDK `AuthenticationError`, `status: 401`; the class leaves `name` as `Error`                                       | `401`    | `authentication`                                                         |
| Gemini           | SDK `ApiError`, `status: 400`; `message` is the JSON error body, whose `details` carry `reason: "API_KEY_INVALID"` | `400`    | `authentication`                                                         |
| Chat Completions | A non-2xx response; Axle throws `{ status, type, message, body }` with the body parsed when it is JSON             | `401`    | `authentication`; the body's own `error.type` stays under `raw.body`     |
| Any              | Any other HTTP failure (`400` without `API_KEY_INVALID`, `403`, `429`, `5xx`)                                      | As sent  | The class name, or the status as a string on Chat Completions, as before |

Observed on 2026-10-01 (AXL-70, 0.32.0) with a bogus key on each factory.
The Gemini check is a substring match on the message because the SDK gives
the body only as a string, and the same body is wrapped in
`got status: ... ` text when it arrives mid-stream.

A `403` is not reported as `authentication`. No provider has been observed
returning one for a bad key; Anthropic and OpenAI use it for a key that is
valid but not permitted, which a consumer should not treat as "send the user
to their key settings".

Rejected (2026-10-02): a separate failure kind for rejected credentials. The
failure is still the provider failing the request, and a consumer that
switches on `kind` to decide whether to retry wants it under `model`; the
`type` is the finer distinction, the same place the provider's own type sits.

## Sources

Read on 2026-10-01:

- Anthropic: [server tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools),
  [web search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool),
  [code execution](https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool).
  Read on 2026-10-02: [refusals and fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback),
  [streaming refusals](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/handle-streaming-refusals),
  [stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons)
- OpenAI: [reasoning](https://developers.openai.com/api/docs/guides/reasoning),
  [conversation state](https://developers.openai.com/api/docs/guides/conversation-state),
  [code interpreter](https://developers.openai.com/api/docs/guides/tools-code-interpreter),
  and the doc comments in `openai/resources/responses/responses.d.ts`
- Gemini: [thought signatures](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures),
  [code execution](https://ai.google.dev/gemini-api/docs/generate-content/code-execution),
  [Google Search](https://ai.google.dev/gemini-api/docs/generate-content/google-search),
  and the `Part` type in `@google/genai`
- OpenRouter: [web search server tool](https://openrouter.ai/docs/guides/features/server-tools/web-search).
  Read on 2026-10-02: [API overview](https://openrouter.ai/docs/api/reference/overview)
  for finish reasons
- Together: the `FinishReason` enum in the
  [chat completions reference](https://docs.together.ai/reference/chat-completions-1),
  read on 2026-10-02
