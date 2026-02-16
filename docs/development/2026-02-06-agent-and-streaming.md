# Agent Primitive and Streaming Refactor

**Date:** 2026-02-06
**Status:** Draft

## Overview

Axle's primary API surface shifts from `Axle` class + `serialWorkflow` to an `Agent` class that owns a conversation and supports multi-turn interaction. Streaming becomes the default execution path.

## Design Principles

- Agent is the primary thing users interact with. No dependency on `Axle` class.
- Instruct remains the prompt engineering layer (template + schema + compile/finalize), but schema becomes optional.
- CLI is a thin consumer of the library API, not the driver.

## Target Usage

```typescript
const provider = new AnthropicProvider({ apiKey: "..." });
const agent = new Agent(provider, {
  system: "You are a helpful assistant",
  tools: [execTool, writeFileTool],
  tracer,
});

const r1 = await agent.send("read the files in src/");
const r2 = await agent.send("now refactor the utils");

// with structured output
const r3 = await agent.send(Instruct.with("summarize {{$previous}}", { summary: "string" }));
```

## Work Items

### Phase 1: Rename and Streaming Foundation

1. **Rename `generate` -> `generateTurn`** — the low-level single LLM call (no tool loop).
2. **Rename `generateWithTools` -> `generate`** — the tool-loop version becomes the primary generate API.
3. **Create `streamWithTools()`** — parallel to `generate()`, uses `stream()` in a tool loop. Callback-based (`onChunk`, `onToolCall`). Returns same result shape as `generate()`.

### Phase 2: Agent Primitive

4. **Create `Agent` class** — owns Conversation, provider, tools, system, tracer. Primary API is `.send(instruct | string)`.
5. **Make Instruct schema optional** — skip tag instruction generation and XML parsing when no schema provided.
6. **Design `TurnResult` return type** for `.send()` — raw text, parsed result (if schema), usage stats.
7. **Agent uses streaming by default** — falls back to non-streaming if provider lacks `createStreamingRequest`.

### Phase 3: API Cleanup

8. **Remove or gut `Axle` class** — Agent doesn't depend on it. Extract provider factory if useful.
9. **Clean up public exports** in `src/index.ts` — Agent, Instruct, providers, tools, tracer.
10. **Update CLI runners** to construct Agent directly instead of going through Axle.

### Phase 4: Follow-on

11. **Deprecate `serialWorkflow`** — Agent subsumes it. Pipeline (running N instructs in sequence) is just a for-loop over `agent.send()`.
12. **Batch runner updated** to use Agent.
13. **Tests** for all of the above.

## Implementation Order

Start with Phase 1 (renames + `streamWithTools`) since it's foundational and doesn't break the existing API shape — just renames internals. Phase 2 builds on streaming. Phase 3 is cleanup after Agent is solid.

## Notes

- Subagents (agent-as-tool) are self-contained and can be built independently whenever needed. Not blocked by any of this work.
- Memory beyond conversation history is a future concern — not in scope here.
- The existing `generateWithTools` design doc (2026-01-09) remains valid for the tool loop semantics; this builds on top of it.
