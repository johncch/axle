# Streaming Format Comparison Across Providers

**Date:** 2026-02-08
**Status:** Analysis

## Overview

Comparison of streaming event formats across all four provider APIs to identify gaps in `AnyStreamChunk` design. Focused on text, thinking/reasoning, tool calls, internal tools, and completion events. Audio and image outputs are out of scope.

## 1. Stream Lifecycle

| Event | Anthropic | Chat Completions | Responses API | Gemini | AnyStreamChunk |
|-------|-----------|-------------------|---------------|--------|----------------|
| Stream start | `message_start` (id, model, usage) | First chunk (id, model) | `response.created` (id, model) | N/A (first chunk) | `start` (id, model, timestamp) |
| Stream end | `message_stop` | `finish_reason` in final chunk | `response.completed` (usage, status) | Done flag | `complete` (finishReason, usage) |
| Error | HTTP error / overload | HTTP error | `response.failed` (status, error) | HTTP error | `error` (type, message) |
| Incomplete | `stop_reason: "end_turn"` always | `finish_reason: "length"` | `response.incomplete_details` | `finish_reason: "MAX_TOKENS"` | Mapped to `AxleStopReason` |

**Gaps:**
- Responses API has a distinct `response.failed` event with structured error info. Currently mapped to generic `error`.
- Responses API `incomplete_details` provides a reason (max_tokens, content_filter). Currently collapsed to `AxleStopReason.Error`.

## 2. Text Content

| Event | Anthropic | Chat Completions | Responses API | Gemini | AnyStreamChunk |
|-------|-----------|-------------------|---------------|--------|----------------|
| Text start | `content_block_start` (index, type) | Implicit (first delta) | `response.output_text.delta` | Implicit | `text` (index, text) |
| Text delta | `content_block_delta` (index, text) | `delta.content` | `response.output_text.delta` | `text` field in candidate | `text` (index, text) |
| Text done | `content_block_stop` (index) | Implicit (finish_reason) | `response.output_text.done` | Implicit | Implicit (next chunk type) |

**Status:** Well-covered. Minor difference: Anthropic has explicit block start/stop, others are implicit. Current design handles this adequately.

## 3. Thinking / Reasoning

| Event | Anthropic | Chat Completions (DeepSeek/Kimi/vLLM) | Responses API | Gemini | AnyStreamChunk |
|-------|-----------|----------------------------------------|---------------|--------|----------------|
| Start | `content_block_start` type=thinking | Implicit (first `delta.reasoning_content`) | `response.output_item.added` type=reasoning | N/A | `thinking-start` (index) |
| Delta | `content_block_delta` thinking text | `delta.reasoning_content` | `response.reasoning_text.delta` | N/A | `thinking-delta` (index, text) |
| Summary delta | N/A | N/A | `response.reasoning_summary_text.delta` | N/A | **Not distinguished** |
| Done | `content_block_stop` | Implicit (no more `reasoning_content`) | `response.reasoning.done` | N/A | Implicit |
| Signature | Present in block (for extended thinking) | N/A | N/A | N/A | **Not captured** |
| Redacted | `is_redacted` flag on block | N/A | N/A | N/A | `redacted` on `thinking-start` |
| Non-streaming | `thinking` content block | `message.reasoning_content` (string) | Reasoning output item with summary | N/A | `ContentPartThinking` |
| Round-trip | Must include thinking blocks with signature | Not standardized — some providers ignore, some expect it back | Must include reasoning item with `id` and summary text | N/A | **Inconsistent** |

The Chat Completions `reasoning_content` extension is widely adopted (DeepSeek, Kimi, vLLM, various OpenAI-compatible servers). It's a simple string field — no IDs, no signatures, no summary vs reasoning distinction. Round-tripping is not standardized; most providers don't require it.

**Gaps:**
- **No ID on thinking chunks.** Responses API reasoning items have an `id` that must be round-tripped for multi-turn. Anthropic thinking blocks don't have a separate ID. Chat Completions thinking has no ID. Current `thinking-start` only has `index`.
- **No distinction between reasoning text vs reasoning summary.** Responses API has both `reasoning_text.delta` and `reasoning_summary_text.delta`. Currently both mapped to `thinking-delta`. For round-tripping, only the summary should go back in conversation history. Chat Completions has no such distinction.
- **No thinking signature.** Anthropic extended thinking includes a `signature` that must be round-tripped. Not captured in `AnyStreamChunk`.
- **`ContentPartThinking` has no `id` field** — needed for Responses API round-trip.
- **Chat Completions thinking not round-tripped.** `convertAssistantMessage` in `chatcompletions/utils.ts` drops thinking parts entirely — only text and tool calls are sent back. This may be fine for most CC providers but is a gap if a provider expects it.

## 4. Tool Calls (User-Defined Functions)

| Event | Anthropic | Chat Completions | Responses API | Gemini | AnyStreamChunk |
|-------|-----------|-------------------|---------------|--------|----------------|
| Tool start | `content_block_start` type=tool_use (id, name) | First `tool_calls[i]` delta (id, name) | `response.output_item.added` type=function_call (id, call_id, name) | `function_call` in candidate | `tool-call-start` (index, id, name) |
| Args delta | `content_block_delta` input_json_delta | `tool_calls[i].function.arguments` delta | `response.function_call_arguments.delta` (item_id, delta) | N/A (full args at once) | **Not in union** (commented out) |
| Tool done | `content_block_stop` | Implicit (finish_reason=tool_calls) | `response.function_call_arguments.done` (item_id, name, arguments) | Implicit | `tool-call-complete` (index, id, name, arguments) |
| Finish reason | `stop_reason: "tool_use"` | `finish_reason: "tool_calls"` | Implicit (has function_call output items) | `finish_reason: "STOP"` (no special) | `AxleStopReason.FunctionCall` |

**Gaps:**
- **Two ID problem.** Responses API function calls have `id` (item identifier, used in streaming as `item_id`) and `call_id` (used for matching with `function_call_output`). Current design has single `id` field. We need `call_id` for round-tripping — this is the ID used in `function_call_output.call_id`.
- **`tool-call-delta` is commented out.** Currently argument deltas are buffered inside adapters. This is fine for now but means consumers can't show partial arguments.
- **Gemini sends full args at once** — no streaming of arguments. Current design accommodates this since `tool-call-complete` has full args.

### Round-trip Formats

How tool calls must be sent back in the next request:

| Provider | Tool call format | Tool result format |
|----------|-----------------|-------------------|
| Anthropic | `content_block` type=tool_use with id, name, input | `role: "user"`, `content: [{ type: "tool_result", tool_use_id, content }]` |
| Chat Completions | `role: "assistant"`, `tool_calls: [{ id, function: { name, arguments } }]` | `role: "tool"`, `tool_call_id`, `content` |
| Responses API | `{ type: "function_call", call_id, name, arguments }` (top-level item) | `{ type: "function_call_output", call_id, output }` (top-level item) |
| Gemini | `functionCall: { name, args }` in parts | `functionResponse: { name, response }` in parts |

## 5. Internal / Built-in Tools

These are tools managed by the API itself (not user functions).

### Web Search

| Provider | Events |
|----------|--------|
| Anthropic | `content_block_start` type=server_tool_use (name="web_search") → `content_block_delta` → `content_block_stop` |
| Chat Completions | N/A (not supported) |
| Responses API | `response.output_item.added` type=web_search_call → `response.web_search_call.completed` (results) |
| Gemini | `grounding_metadata` in response (not streamed per-result) |

### File Search / Code Interpreter

| Provider | Events |
|----------|--------|
| Responses API | `response.output_item.added` type=file_search_call → results; type=code_interpreter_call → `response.code_interpreter_call.code.delta` / `.done` |
| Others | N/A |

**Gaps:**
- **No internal tool event type in AnyStreamChunk.** Web search, file search, and code interpreter results from Responses API have no representation.
- These could potentially be mapped to tool-call-start/complete with a special flag, or need dedicated chunk types.

## 6. Refusal

| Provider | How refusal is communicated |
|----------|-----------------------------|
| Anthropic | `stop_reason: "end_turn"` with refusal text in content |
| Chat Completions | `delta.refusal` field (separate from `delta.content`) |
| Responses API | `response.refusal.delta` / `response.refusal.done` |
| Gemini | `finish_reason: "SAFETY"` with safety ratings |

**Gaps:**
- **No refusal chunk type.** Chat Completions and Responses API distinguish refusal text from content text. Currently would be mixed into `text` chunks or lost.

## 7. Citations / Annotations

| Provider | Format |
|----------|--------|
| Anthropic | `citations` array in text content blocks |
| Chat Completions | `annotations` array in message |
| Responses API | `response.output_text.annotation.added` events |
| Gemini | `grounding_metadata.grounding_chunks` |

**Gaps:**
- **No citation/annotation support.** None of the providers' citation data is captured.

## 8. Summary of Gaps

### Critical (blocks correct multi-turn behavior)

1. **Thinking/reasoning ID** — Responses API reasoning items need their `id` round-tripped. Requires adding `id` to `thinking-start` and `ContentPartThinking`.
2. **Reasoning vs summary distinction** — Responses API has separate reasoning text (internal) and summary text (for round-tripping). Currently conflated.
3. **Tool call `call_id`** — Responses API uses `call_id` (not `id`/`item_id`) for function_call ↔ function_call_output matching. The `id` field in `tool-call-start` must carry the `call_id`.
4. **Thinking signature** — Anthropic extended thinking requires `signature` round-tripped. Not captured.

### Important (feature gaps)

5. **Internal tool events** — Web search, file search, code interpreter from Responses API have no representation.
6. **Refusal** — Separate refusal text from Chat Completions and Responses API is not distinguished from content.

### Nice to have

7. **Incomplete reason** — More granular than just error (max_tokens vs content_filter vs other).
8. **Citations/annotations** — No provider's citation data is captured.
9. **Tool call argument deltas** — Commented out, preventing streaming partial args to consumers.

## 9. Proposed Changes to AnyStreamChunk

### Add `id` to thinking chunks

```typescript
interface StreamThinkingStartChunk {
  type: "thinking-start";
  data: {
    index: number;
    id?: string;        // Responses API reasoning item ID
    redacted?: boolean;
    signature?: string; // Anthropic extended thinking signature
  };
}
```

### Add `callId` to tool call chunks

```typescript
interface StreamToolCallStartChunk {
  type: "tool-call-start";
  data: {
    index: number;
    id: string;     // call_id for Responses API, tool_use id for Anthropic
    name: string;
  };
}
// id already serves as call_id — just ensure adapters emit the right one
```

### Consider: thinking-summary-delta

```typescript
interface StreamThinkingSummaryDeltaChunk {
  type: "thinking-summary-delta";
  data: {
    index: number;
    text: string;
  };
}
```

Or use a flag on `thinking-delta`: `data: { index, text, isSummary?: boolean }`.

### Consider: refusal chunk

```typescript
interface StreamRefusalChunk {
  type: "refusal";
  data: {
    text: string;
    index: number;
  };
}
```
