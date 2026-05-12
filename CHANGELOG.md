# Changelog

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
