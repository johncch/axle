# Options Refactor

Date: 2026-05-22

## Goal

Axle request options should describe portable behavior that Axle understands, not a loose bag of provider request fields.

The old `options` key mixed three different concerns:

- normalized controls such as `temperature` and token limits
- raw provider-specific fields such as cache controls
- internal Axle plumbing such as provider tools

That made it unclear which fields Axle promised to map portably and which fields were just passed through.

## Public Shape

The request option surface is now:

```ts
export type ToolChoice = "auto" | "none" | "required" | { type: "tool"; name: string };

export interface AxleModelRequestOptions {
  reasoning?: boolean;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: string | string[];
  toolChoice?: ToolChoice;
  parallelToolCalls?: boolean;
  providerOptions?: ProviderOptions;
  signal?: AbortSignal;
}
```

`AgentConfig`, `agent.send()`, `generate()`, and `stream()` use the same normalized request option names.

## First-Class Option Rubric

A field belongs in `AxleModelRequestOptions` when:

- Axle understands the semantic intent.
- The option is portable across most providers.
- The provider mappings have roughly equivalent behavior.
- Axle can fail clearly when a provider cannot honor the option.

Fields that do not meet that bar belong in `providerOptions`.

Examples:

- `reasoning` is first-class because Axle can map the broad intent across providers.
- `maxOutputTokens`, `temperature`, `topP`, and `stop` are first-class because they are common request controls.
- `frequencyPenalty` and `presencePenalty` are not first-class because they are not portable enough across Axle's providers.
- Cache controls are not first-class because the provider APIs and lifecycles are too different.

## Provider Options

`providerOptions` is the explicit escape hatch for raw provider-specific fields.

Adapters apply request fields in this order:

1. provider defaults
2. Axle normalized fields
3. `providerOptions`

That means `providerOptions` can override Axle's normalized mapping. This is intentional: once the user reaches for a provider-specific escape hatch, provider-specific behavior wins.

Example:

```ts
await generate({
  provider,
  model,
  messages,
  maxOutputTokens: 500,
  providerOptions: {
    max_tokens: 1000,
  },
});
```

For a Chat Completions-compatible provider, this sends `max_tokens: 1000`.

## Provider Tools

Provider tools are not request options. They remain Axle plumbing from the registry to provider adapters.

They should be passed separately as `providerTools`, not nested inside `providerOptions`.

## Merge Semantics

Agent defaults are merged with per-message options:

```ts
agent defaults < send options
```

For `providerOptions`, the merge is shallow:

```ts
agent.providerOptions < send.providerOptions
```

For scalar fields and arrays such as `stop`, per-send values replace agent defaults.

## Provider Mapping

| Axle option | OpenAI Responses | Anthropic Messages | Gemini | Chat Completions |
| --- | --- | --- | --- | --- |
| `reasoning` | `reasoning` | `thinking` | `thinkingConfig` | `reasoning_effort` |
| `maxOutputTokens` | `max_output_tokens` | `max_tokens` | `maxOutputTokens` | `max_tokens` |
| `temperature` | `temperature` | `temperature` | `temperature` | `temperature` |
| `topP` | `top_p` | `top_p` | `topP` | `top_p` |
| `stop` | unsupported | `stop_sequences` | `stopSequences` | `stop` |
| `toolChoice` | `tool_choice` | `tool_choice` | `toolConfig.functionCallingConfig` | `tool_choice` |
| `parallelToolCalls` | `parallel_tool_calls` | `disable_parallel_tool_use` | unsupported | `parallel_tool_calls` |

Unsupported normalized options should fail clearly instead of being silently omitted.
