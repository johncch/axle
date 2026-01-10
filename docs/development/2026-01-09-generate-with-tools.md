# Generate With Tools Helper

**Date:** 2026-01-09  
**Status:** Draft

## Overview

Repeated tool-call loops are currently implemented by consumers and by `serialWorkflow`. This document proposes a lower-level `generateWithTools` helper that sits between `generate` and higher-level workflows. It executes tool calls until the model stops, and returns the delta messages needed to update a conversation.

Streaming is explicitly out of scope for this design.

## Goals

- Provide a low-level helper that handles tool call loops.
- Keep the API non-throwing (aligned with `generate`).
- Return only the new messages produced during the loop.
- Allow tool execution to be supplied by the caller (no forced Tool interface).
- Allow callers to enforce stricter policies (tool failures, iteration limits).

## Non-goals

- Automatic streaming tool loops.
- Workflow orchestration, schema validation, or `Instruct` concerns.
- Hard coupling to the `Tool` interface.

## Proposed API (Draft)

```ts
type GenerateWithToolsOptions = {
  provider: AIProvider;
  messages: AxleMessage[];
  system?: string;
  tools?: ToolDefinition[];
  onToolCall: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<ToolCallResult | null | undefined>;
  maxIterations?: number; // cap on model calls; undefined means no cap
  recorder?: Recorder;
  options?: GenerateOptions;
};

type ToolCallResult =
  | { type: "success"; content: string }
  | {
      type: "error";
      error: { type: string; message: string; fatal?: boolean; retryable?: boolean };
    };

type GenerateWithToolsError =
  | { type: "model"; error: ModelError }
  | { type: "tool"; error: { name: string; message: string } };

type GenerateWithToolsResult =
  | {
      result: "success";
      messages: AxleMessage[];
      final?: AxleAssistantMessage;
      usage?: Stats;
    }
  | {
      result: "error";
      messages: AxleMessage[];
      error: GenerateWithToolsError;
      usage?: Stats;
    };

async function generateWithTools(
  options: GenerateWithToolsOptions,
): Promise<GenerateWithToolsResult>;
```

## Error Handling Policy

### Provider errors

- Returned as `{ result: "error", error: ModelError }`.
- No throwing at this layer.
- `messages` includes any assistant/tool messages generated before the error.

### Tool execution errors

- Encoded as tool results (model-visible) using the `ToolCallResult` error shape.
- Non-fatal errors are surfaced to the model; the loop may continue.
- The helper ignores `fatal`/`retryable` flags for now; only `null`/`undefined` signals a fatal tool error.

### Tool not found

- Considered the only fatal tool error.
- `onToolCall` should return `null`/`undefined` for "not found."
- The helper emits a tool error result and returns `{ result: "error", error: { type: "tool", ... } }`.

### Iteration cap

- If `maxIterations` is hit, the helper returns `{ result: "error" }` with a model error type of
  `MaxIterations`.

## Tool Execution Strategy

To keep the API flexible, tool execution is delegated to `onToolCall`. This allows:

- Calling remote tools without conforming to the `Tool` interface.
- Custom retries and timeouts.
- Centralized policy control (e.g., fail-fast, append error and continue).

Optional future extension:

- Accept either `Tool[]` or `{ tools: ToolDefinition[]; onToolCall }` with overloads.

## Conversation Integration

The helper returns only new messages. This allows a simple conversation helper:

```ts
conversation.addMessages(result.messages);
```

This avoids message slicing and makes usage consistent across workflows and custom consumers.

## Usage Aggregation

The helper aggregates usage across iterations into a single `usage` field.

## Example Usage

```ts
const tools = [
  {
    name: "search",
    description: "Search the web",
    schema: searchSchema,
  },
];

const registry = {
  search: async (params: Record<string, unknown>) => {
    const result = await runSearch(params);
    return JSON.stringify(result);
  },
};

const res = await generateWithTools({
  provider,
  messages,
  tools,
  maxIterations: 5,
  onToolCall: async (name, params) => {
    const handler = registry[name as keyof typeof registry];
    if (!handler) return null;
    try {
      return { type: "success", content: await handler(params) };
    } catch (error) {
      return {
        type: "error",
        error: {
          type: "execution",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  },
});

if (res.result === "error") {
  // handle model errors or missing tools
}

conversation.addMessages(res.messages);
```

## Naming Considerations

`generate` already accepts `tools` as definitions, so a name that implies execution is clearer.
Options:

- `generateWithToolCalls` (explicit about handling tool calls)
- `generateWithToolExecution` (emphasizes side-effectful execution)
- `generateWithToolLoop` (signals the iterative behavior)

The recommendation is to keep `generate` unchanged and add a new helper with an explicit name,
to avoid surprising side effects or breaking existing usage.

## Open Questions

- Should `ToolCallResult` include a typed `not-found` variant instead of `null`?
