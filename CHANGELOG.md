# Changelog

## [0.25.4] - 2026-06-17

- Improved `parallelize` handling for more reliable batched tool execution.

## [0.25.3] - 2026-06-16

- Fixed OpenAI file handling so filenames and URLs are resolved correctly.

## [0.25.2] - 2026-06-15

- Fixed tool calls with syntactically invalid JSON parameters so they are handled gracefully instead of failing.

## [0.25.1] - 2026-06-13

- Consolidate vendor options for ChatCompletions

## [0.25.0] - 2026-06-12

- Added a web search fallback for more reliable search behavior.
- Improved handling of non-text tool results.

## [0.24.0] - 2026-06-11

- Added experimental subagent tools for delegating bounded work to other agents.
- Added experimental parallel tool execution for running batched tool calls concurrently.
- Added tool context helpers for reporting usage and adding contextual information during runs.
- Improved streaming/tool-call behavior and error reporting for more consistent agent runs.
- Fixed output fencing in generated content.

## [Unreleased]

- Added `createAgentTool` for delegating bounded work to subagents exposed as tools (experimental)
- Added `parallelize` for wrapping a tool in a concurrent batch variant (experimental)
- Added `ctx.reportUsage` to `ToolContext` and a flat per-provider/model `Stats.breakdown` for cost reconstruction across models (experimental)
- Added child turn-event forwarding for subagent tools (`action:child-event`, rendered as agent action parts) (experimental)
- Added `tool:exec-error` stream event for fatal/aborted tool calls (experimental); `Agent.on()` now returns an unsubscribe function
- **Behavior change:** in `stream()`, a user-provided `onToolCall` returning `null`/`undefined` now falls through to executing the matching registry tool (matching `generate()`'s existing semantics) instead of producing a `not-found` result. Return an explicit `{ type: "error", ... }` result to block a tool.
- **Behavior change:** a tool throwing an error merely named `AbortError` (e.g. an internal fetch timeout) while the run's signal is live is now reported to the model as an ordinary tool error instead of aborting the run

## [0.23.1] - 2026-06-08

- Updated Anthropic thinking configuration support

## [0.23.0] - 2026-06-08

- Improved observability with a simplified span-based tracing interface
- Added richer trace events, span completion details, and token/content logging for agent and streaming runs
- Added provider tool logging and support for routing observability data to multiple sinks

## [0.22.1] - 2026-06-07

- Improved handling of chat-completions streaming errors
- Fixed Gemini citation handling

## [0.22.0] - 2026-06-06

- Added support for OpenRouter web search citations
- Improved citation handling for web search results
- Fixed tool handling for interleaved tool calls

## [0.21.0] - 2026-05-30

- Added support for Opus 4.8
- Added support for citations and thinking formats
- Added configurable retry options
- Added a convenience method for rehydrating agents
- Added metadata support for turns and messages

## [0.20.0] - 2026-05-25

- Split the library and CLI into separate packages for clearer installation and usage
- Added `AgentSession` and snapshot restore APIs for saving and resuming agent sessions
- Added `createAgentConfig` for easier agent configuration
- Updated memory handling so memory is managed separately from `AgentConfig`
- Added documentation updates and removed Brave-related docs/support

## [0.19.0] - 2026-05-24

- Added a browser-only export for client-side bundles that omits server-only code
- Added annotations support to Turns

## [0.18.0] - 2026-05-22

- Added support for Gemini 3.5 Flash
- Standardized request options across providers, including output tokens, temperature, top-p, stop sequences, tool choice, and provider-specific options
- Renamed provider option types and runtime parameters; see the 0.18.0 migration guide for update details
- Updated usage stats to include cached tokens and thinking tokens
- Added a simple context counter and split MCP tools for more flexible tool usage
- Fixed bugs found during smoke testing

## [0.17.0] - 2026-05-13

- Updated the Instruct constructor to use object-style options
- Improved Instruct schema typing to support any Zod schema
- Added clearer errors for missing template variables
- Improved result ergonomics for easier handling by applications

## [0.16.3] - 2026-05-13

- Added vars mode to Instruct for easier variable-based prompting
- Fixed bugs found through live provider testing

## [0.16.2] - 2026-05-11

- Fixed OpenAI and Chat Completions providers: `reasoning: false` now sends no reasoning effort instead of minimal reasoning

## [0.16.1] - 2026-05-11

- Added `z.enum` and `z.literal` support to Instruct structured-output schemas

## [0.16.0] - 2026-05-11

- Added `instruct` support to generate and stream APIs for supplying structured instructions directly
- Updated structured output instructions to use JSON for more reliable parsing
- Added open-weight model options
- Improved cancellation behavior by propagating abort signals through MCP tool calls

## [0.15.1] - 2026-05-08

- Added `AxleToolFatalError` for fatal tool failures, allowing generation, streaming, and agent runs to stop immediately without retrying or exposing the error to the model
- Fatal tool errors now preserve available partial output, messages, usage, and tool context for easier handling by applications

## [0.15.0] - 2026-05-08

- Abort operations now throw errors, making cancellation behavior easier to detect and handle

## [0.14.0] - 2026-05-07

- Simplified the Agent and Instruct APIs for easier use and better TypeScript support
- Added support for binding inputs to Instruct templates with `withInputs`, `withInput`, and `clone`
- Improved template variable handling by consistently reporting missing required variables

## [0.13.0] - 2026-05-06

- Added provider tool registries for configuring and organizing available tools
- Added streaming support for tool outputs and tool arguments
- Improved tool execution with abort-signal support and streamed command output
- Updated available models

## [0.12.0] - 2026-04-30

- Added basic thinking/reasoning support to the generation API
- Added file support improvements: better `FileInfo` types, improved image type checks, file data support in chat completions, and new usage examples
- Removed `instructions` as a concept from `Instruct`, simplifying the interface

## [0.11.0] - 2026-04-24

- Added support for OpenAI models
- Provider models are now exported from the package

## [0.10.2] - 2026-04-24

- Added timing information to agent/generation output
- Added support for Claude Opus 4.7

## [0.10.1] - 2026-04-07

- Update distribution artifacts and config

## [0.10.0] - 2026-04-05

- Agent now emits Turns, with an updated agent interface to match
- Agent history now carries both Turn and Message parts in parallel, improving fidelity when converting between representations
- Added configuration support to hooks
- Improved error semantics and error reporting for tool-call not found cases
- Fixed a bug where history could be incorrectly committed when a cancellation was in flight
- Updated to latest dependencies and models

## [0.9.0] - 2026-02-22

- Added procedural memory support, allowing agents to retain and recall information across interactions
- Made the tool call callback optional when using `generate`, reducing boilerplate for simple use cases
- Simplified tracing interfaces for easier integration and usage
