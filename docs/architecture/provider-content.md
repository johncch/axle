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

| Content                                                                                                                                                                                 | Stored as                                                                                                                                                                                                                                                                                                      | Sent back                                                                    | Provider requires                                                                                                                                                                                                                                                                                                                                   | Owner                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `text`                                                                                                                                                                                  | `text` part; its `citations` are normalized onto the part                                                                                                                                                                                                                                                      | Rebuilt: text plus its Anthropic citations, without the response's `file_id` | "Send the assistant's content blocks back exactly as you received them"; a citation's `encrypted_index` "must be passed back for multi-turn conversations". Observed on 2026-10-01 (AXL-64, `claude-haiku-4-5`): a follow-up request is accepted with or without the citations                                                                      | —                                                                               |
| `thinking`, `redacted_thinking`                                                                                                                                                         | `thinking` part                                                                                                                                                                                                                                                                                                | Rebuilt                                                                      | See [thinking.md](thinking.md)                                                                                                                                                                                                                                                                                                                      | —                                                                               |
| `tool_use`                                                                                                                                                                              | `tool-call` part (id, name, parsed input)                                                                                                                                                                                                                                                                      | Rebuilt                                                                      | Each `tool_use` needs a `tool_result` in the next message                                                                                                                                                                                                                                                                                           | `caller` and `toolset_name` are not stored: AXL-71                              |
| `server_tool_use`                                                                                                                                                                       | `provider-tool` part (id, name, `input`)                                                                                                                                                                                                                                                                       | Rebuilt                                                                      | Later requests must define the same tool; a call that has not run yet runs at the start of the next request                                                                                                                                                                                                                                         | `caller` is not stored: AXL-71                                                  |
| `web_search_tool_result`, `web_fetch_tool_result`, `code_execution_tool_result`, `bash_code_execution_tool_result`, `text_editor_code_execution_tool_result`, `tool_search_tool_result` | `output` of the `provider-tool` part with the matching id, as the whole block. When the call is in an earlier message, a `provider-tool-result` part in the position the block arrived. A block whose `content` is a `*_tool_result_error` object is stored the same way and reported as `provider-tool:error` | As received                                                                  | Search results: "If `encrypted_content` is missing or modified, the request fails with a 400 validation error". A result that arrives in a later response stays there: "keep the whole exchange in your `messages` array in order". Observed on 2026-10-01 (AXL-65, `claude-haiku-4-5`): a later request without that result is rejected with a 400 | —                                                                               |
| `container_upload`                                                                                                                                                                      | Dropped                                                                                                                                                                                                                                                                                                        | No                                                                           | Not checked                                                                                                                                                                                                                                                                                                                                         | Accepted: only produced by code execution, which Axle does not map on Anthropic |
| Beta-only blocks: `mcp_tool_use`, `mcp_tool_result`, `mcp_tool_listing`, `compaction`, `advisor_tool_result`, `fallback`                                                                | Dropped                                                                                                                                                                                                                                                                                                        | No                                                                           | Not checked                                                                                                                                                                                                                                                                                                                                         | Accepted: Axle calls the non-beta endpoint, whose union has none of these       |

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
| Assistant, first step | `provider-tool` with `input` and no `output`; `tool-call` |
| Tool                  | The client tool results                                   |
| Assistant, next step  | `provider-tool-result` with the same `id`; then the rest  |

The result block names its call by id but not by tool name. Before each
request the Anthropic provider reads the conversation for `provider-tool`
parts that have no `output` and no later `provider-tool-result`, and gives
their ids and names to the adapter. A result block that matches none of them
is dropped. `provider-tool:complete` fires in the step the result arrives
in, with the id of the original call.

A turn that stops between the two steps (`maxSteps`, `stop()`, a fatal tool
error) leaves a `provider-tool` part that never gets a result. Anthropic's
docs say a later user message is then rejected. Axle does not repair this.

Response-level state:

| Content                                  | Stored as                                  | Sent back | Provider requires                                                                                                                                      | Owner                                                                                                                                 |
| ---------------------------------------- | ------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `container` (`id`, `expires_at`)         | Dropped                                    | No        | "Each request runs in a new container unless you pass an earlier response's container ID back." A request naming an expired container returns an error | Accepted: only carries code execution state. Observed on 2026-10-01 (AXL-51, `claude-sonnet-5-5`): a follow-up without it is accepted |
| `stop_reason: "pause_turn"`              | Not stored; the adapter continues the turn | —         | "Pass the paused response back as-is"; include the same tools                                                                                          | —                                                                                                                                     |
| `stop_reason: "refusal"`, `stop_details` | `finishReason: "error"`; details dropped   | No        | Not checked                                                                                                                                            | AXL-67                                                                                                                                |

## OpenAI (Responses API)

Axle calls `client.responses.stream`. It sets none of `store`,
`previous_response_id`, or `include`, so every request carries the whole
conversation as input items. Output items are the SDK's `ResponseOutputItem`
union.

| Content                                                                                                                                                                                                                                                                                                         | Stored as                                                                                                                                                                                  | Sent back                                                                                  | Provider requires                                                                                                                                                                                                                                                                            | Owner                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `message` with `output_text`                                                                                                                                                                                                                                                                                    | One `text` part per text content part; `annotations` normalized into `citations`; the item's `phase` kept in `providerMetadata`                                                            | Rebuilt: each run of adjacent text with the same `phase` as one `{ role, content, phase }` | "Preserve every item in the response's `output` array." `phase`: "preserve and resend phase on all assistant messages — dropping it can degrade performance"                                                                                                                                 | The item `id` and annotations are not sent back: AXL-71 |
| `message` with `refusal`                                                                                                                                                                                                                                                                                        | Dropped; `response.refusal.*` events have no handler                                                                                                                                       | No                                                                                         | Not checked                                                                                                                                                                                                                                                                                  | AXL-67                                                  |
| `reasoning`                                                                                                                                                                                                                                                                                                     | `thinking` part; `encrypted_content` is taken from `response.output_item.done`                                                                                                             | Rebuilt, only when `encrypted_content` was captured                                        | "We highly recommend you pass back any reasoning items returned with the last function call." The SDK says the `encrypted_content` on `output_item.added` "may be incomplete". Observed on 2026-10-01 (`gpt-6-luna`): the two values differ, and a follow-up request is accepted with either | —                                                       |
| `function_call`                                                                                                                                                                                                                                                                                                 | `tool-call` part (`call_id` as id, name, parsed arguments)                                                                                                                                 | Rebuilt, without the item `id`                                                             | "Ensure all items between the last user message and your function call output are passed into the next response untouched"                                                                                                                                                                   | —                                                       |
| `web_search_call`, `file_search_call`, `code_interpreter_call`                                                                                                                                                                                                                                                  | `provider-tool` part: name is the item type, `output` is the whole item; `input` is unset. An item whose `status` is `failed` is stored the same way and reported as `provider-tool:error` | As received                                                                                | Same "preserve every item" rule. A search that followed a reasoning item needs that item directly before it                                                                                                                                                                                  | —                                                       |
| Everything else: `image_generation_call`, `mcp_call`, `mcp_list_tools`, `mcp_approval_request`, `mcp_approval_response`, `computer_call`, `local_shell_call`, `shell_call`, `apply_patch_call`, `custom_tool_call`, `tool_search_call`, `compaction`, `program`, `additional_tools`, and their `*_output` items | Dropped; the stream events are logged as unhandled                                                                                                                                         | No                                                                                         | Same "preserve every item" rule                                                                                                                                                                                                                                                              | Accepted: Axle has no portable name for these tools     |

Items are sent back in the order OpenAI returned them, because the stored
parts keep that order and the converter walks them in sequence. OpenAI
requires it: a `reasoning` item must sit directly before the
`web_search_call` it led to. Observed on 2026-10-01 (AXL-51, `gpt-6-luna`):
a request that carried the reasoning item, but with another item between it
and its search, was rejected with "Item ... of type 'web_search_call' was
provided without its required 'reasoning' item". Text parts with nothing sent
between them are joined into one message item.

Response-level state:

| Content                         | Stored as                                           | Sent back            | Provider requires                                                                                                                                                              | Owner    |
| ------------------------------- | --------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| `response.id`                   | The assistant message `id`                          | No                   | Only needed for `previous_response_id`, which Axle does not use                                                                                                                | —        |
| Code interpreter `container_id` | Kept inside the stored `code_interpreter_call` item | As part of that item | Auto mode "reuses an active container that was used by a previous `code_interpreter_call` item in the model's context". "A container expires if it is not used for 20 minutes" | —        |
| `incomplete_details`            | `finishReason: "error"`; the reason is dropped      | No                   | Not checked                                                                                                                                                                    | Accepted |

## Gemini (`generateContent`)

Axle calls `client.models.generateContentStream`. Google's current guides
describe the newer Interactions API; the rows below were checked against the
`generate-content/` guides and the SDK's `Part` type. Content arrives as
fields on a `Part`.

| Content                                          | Stored as                                                                           | Sent back                   | Provider requires                                                                                                                 | Owner                                                                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `text`                                           | `text` part                                                                         | Rebuilt                     | —                                                                                                                                 | —                                                                                                                 |
| `text` with `thought: true`                      | `thinking` part                                                                     | Rebuilt                     | See [thinking.md](thinking.md)                                                                                                    | —                                                                                                                 |
| `thoughtSignature` on a part with empty text     | `thinking` part holding only the signature                                          | Rebuilt                     | See [thinking.md](thinking.md)                                                                                                    | —                                                                                                                 |
| `functionCall`                                   | `tool-call` part; its `thoughtSignature` in `providerMetadata`                      | Rebuilt, with the signature | Gemini 3: "you must pass back thought signatures during function calling, otherwise you will get a validation error"              | —                                                                                                                 |
| `thoughtSignature` on a part with non-empty text | Dropped; the adapter reads the signature only on empty-text and function-call parts | No                          | "The final content part (text, inlineData…) returned by the model may contain a thought_signature." Returning it "is recommended" | AXL-68. thinking.md lists this echo path, but nothing writes the value                                            |
| `executableCode`, `codeExecutionResult`          | Dropped; logged as an unhandled part                                                | No                          | "You must pass back the id and thought_signature fields for tool combination to work"                                             | AXL-68. `code_execution` is a mapped provider tool, yet its output is not stored and no provider-tool event fires |
| `toolCall`, `toolResponse`                       | Dropped; logged as an unhandled part                                                | No                          | SDK: "The client is expected to echo this message back to the API"                                                                | AXL-68                                                                                                            |
| `inlineData`, `fileData`                         | Dropped; logged as an unhandled part                                                | No                          | Not checked                                                                                                                       | Accepted: the README states Axle has no multi-modal output                                                        |

Fields on the candidate, outside its parts:

| Content                                                      | Stored as                                  | Sent back | Provider requires                                                                                        | Owner    |
| ------------------------------------------------------------ | ------------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------- | -------- |
| `groundingMetadata.groundingChunks` with `groundingSupports` | `citations` on the text part they point at | No        | Not stated                                                                                               | —        |
| `groundingMetadata.searchEntryPoint`                         | Dropped                                    | No        | "Contains the HTML and CSS to render the required Search Suggestions." A display rule, not a replay rule | Accepted |
| `groundingMetadata.webSearchQueries` and its other fields    | Dropped                                    | No        | Not stated                                                                                               | Accepted |
| `citationMetadata`                                           | `citations` on the last text part          | No        | Not checked                                                                                              | —        |
| `urlContextMetadata`                                         | Dropped                                    | No        | Not checked                                                                                              | Accepted |

Google Search returns no part of its own, so a Gemini search produces
citations but no `provider-tool` part and no provider-tool stream event.
Accepted.

## Chat Completions (generic, OpenRouter, Together)

Axle speaks the wire format directly, with its own types in
`providers/chatcompletions/types.ts`. A field those types do not list is
ignored.

| Content                                                         | Stored as                                                                 | Sent back                                   | Provider requires                         | Owner                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------- | ------------------------------------- |
| `content`                                                       | `text` part                                                               | Rebuilt: all text joined into one `content` | Not checked                               | —                                     |
| `tool_calls`                                                    | `tool-call` part                                                          | Rebuilt                                     | Not checked                               | —                                     |
| `reasoning_details` (OpenRouter)                                | `thinking` parts with continuity                                          | Rebuilt, for the `openrouter` vendor only   | See [thinking.md](thinking.md)            | —                                     |
| `reasoning`, `reasoning_content`                                | `thinking` part                                                           | No                                          | See [thinking.md](thinking.md)            | —                                     |
| `annotations` of type `url_citation`                            | `citations` on the open text part, or a `citation` part when not anchored | No                                          | OpenRouter's web search guide: not stated | —                                     |
| `annotations` of any other type                                 | Dropped                                                                   | No                                          | Not checked                               | Accepted                              |
| Fields outside Axle's wire types, such as `refusal` and `audio` | Dropped                                                                   | No                                          | Not checked                               | `refusal`: AXL-67. The rest: accepted |

OpenRouter's `openrouter:web_search` server tool reports its results as
`url_citation` annotations, so it too produces no `provider-tool` part.
Accepted.

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

## Sources

Read on 2026-10-01:

- Anthropic: [server tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools),
  [web search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool),
  [code execution](https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool)
- OpenAI: [reasoning](https://developers.openai.com/api/docs/guides/reasoning),
  [conversation state](https://developers.openai.com/api/docs/guides/conversation-state),
  [code interpreter](https://developers.openai.com/api/docs/guides/tools-code-interpreter),
  and the doc comments in `openai/resources/responses/responses.d.ts`
- Gemini: [thought signatures](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures),
  [code execution](https://ai.google.dev/gemini-api/docs/generate-content/code-execution),
  [Google Search](https://ai.google.dev/gemini-api/docs/generate-content/google-search),
  and the `Part` type in `@google/genai`
- OpenRouter: [web search server tool](https://openrouter.ai/docs/guides/features/server-tools/web-search)
