# Lifecycle Scenario Tests

Tests verifying the tracer span lifecycle for `stream()` and `generate()`.

## Span Lifecycle Model

Both `stream()` and `generate()` create a tree of spans when given a `tracer` (TracingContext):

```
root span (passed in by caller)
├── turn-1        (type: "llm")    ← one per provider call
├── tool-name     (type: "tool")   ← one per tool execution
├── turn-2        (type: "llm")
└── ...
```

**Both `stream()` and `generate()` turn spans** follow the same event sequence:
```
span:start → span:update (setResult) → span:end
```

**Tool spans** are created by `executeToolCalls()` and have three outcomes:
- `onToolCall` returns success → span ends with status `"ok"`
- `onToolCall` returns null (not found) or error → span ends with status `"error"`
- `onToolCall` throws → caught, span ends with status `"error"`

**Root span** gets `setResult` with the final LLM result, then `end()`. On error, both the turn span and root span end with `"error"` status.

**Known gap:** If the provider itself throws (generator throws for stream, `createGenerationRequest` rejects for generate), the turn and root spans are never ended (leaked). Tests 2.5 and 6.3 document this.

## What Each Test Verifies

### stream() — Happy Paths

| Test | Scenario | Key assertions |
|------|----------|----------------|
| 1.1 | Single text response | Span ordering, setResult + end lifecycle, usage/finishReason on spans |
| 1.2 | Tool call → text | 4 spans (root + turn + tool + turn), correct parent/type, messages accumulate (assistant → tool result → assistant), usage sums across turns |
| 1.3 | Two tool calls in one turn | Both tool spans created sequentially under root, both end before turn-2 starts |
| 1.5 | Thinking + text | Span result contains both thinking and text parts |

### stream() — Error Paths

| Test | Scenario | Key assertions |
|------|----------|----------------|
| 2.1 | Error chunk (no prior text) | Turn and root spans both end with `"error"`, root result has no finishReason |
| 2.2 | Error after partial text | Both turn and root spans marked error |
| 2.3 | Stream ends without complete chunk | Produces `IncompleteStream` error, both spans error |
| 2.4 | maxIterations exceeded | First turn completes tool call, second iteration blocked, produces `MaxIterations` error |
| 2.5 | Provider generator throws | Promise rejects (not a structured error), **turn and root spans are leaked** |

### stream() — Cancellation

| Test | Scenario | Key assertions |
|------|----------|----------------|
| 3.1 | Cancel before run starts | Deterministic via microtask ordering — `cancel()` sets abort before deferred `run()` fires |
| 3.2 | Cancel mid-stream | Uses gated async provider; waits for gate, then cancels. Result is `"cancelled"` |

### stream() — Tool Spans

| Test | Scenario | Key assertions |
|------|----------|----------------|
| 7.2 | `onToolCall` returns null | Tool span status `"error"`, result output is `null` |
| 7.3 | `onToolCall` returns error | Tool span status `"error"`, result kind is `"tool"` |
| 7.4 | `onToolCall` throws | Exception caught by `executeToolCalls`, same outcome as 7.3 |

### generate() — Happy Paths

| Test | Scenario | Key assertions |
|------|----------|----------------|
| 5.1 | Single text response | span:update for setResult, usage/finishReason on spans |
| 5.2 | Tool call → text | 4 spans with correct ordering, messages accumulate |

### generate() — Error Paths

| Test | Scenario | Key assertions |
|------|----------|----------------|
| 6.1 | Provider returns ModelError | Turn span ends with `"error"` (via `setTurnResult`), root span ends with `"error"` |
| 6.2 | maxIterations exceeded | Same as stream 2.4 but via generate path |
| 6.3 | Provider throws | Promise rejects, **turn and root spans are leaked** (same gap as 2.5) |

## Adding a New Test

### 1. Pick the right file

- Testing `stream()` span behavior → `stream-lifecycle.test.ts`
- Testing `generate()` span behavior → `generate-lifecycle.test.ts`

### 2. Set up tracer and provider

```ts
const { writer, tracer } = createTracerAndWriter();
const rootSpan = tracer.startSpan("stream", { type: "workflow" });

// For stream tests: build chunk sequences per turn
const provider = makeStreamingProvider([turn1Chunks, turn2Chunks]);

// For generate tests: build response objects per turn
const provider = makeGenerateProvider([response1, response2]);
```

### 3. Build chunk sequences (stream tests)

Each turn is an array of chunks. A minimal text turn:
```ts
[startChunk("msg_1"), textStartChunk(0), textChunk(0, "Hi"), textCompleteChunk(0), completeChunk()]
```

A tool-call turn (triggers another iteration):
```ts
[startChunk("msg_1"), toolCallStartChunk(0, "call_1", "name"), toolCallCompleteChunk(0, "call_1", "name", {args}), completeChunk(AxleStopReason.FunctionCall)]
```

### 4. Assert against `writer.timeline` and `writer.spans`

- `timeline` — ordered array of `LifecycleEvent`s. Use `eventIndex(timeline, type, name)` to find positions and assert ordering.
- `spans` — `Map<spanId, SpanData>`, populated on `onSpanEnd`. Use `[...spans.values()].find(s => s.name === "turn-1")` to look up final span state.

### 5. Assign an ID

Use the next available number in the relevant category (e.g., `"1.6 ..."` for a new stream happy path).
