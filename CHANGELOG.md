# Changelog

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
