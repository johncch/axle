# Changelog

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
