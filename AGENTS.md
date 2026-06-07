# Agent Guidance

## Feature Coverage

Every major feature should include harness coverage in addition to focused unit
tests. When adding or changing provider behavior, streaming semantics, tool
handling, message formats, or public workflows, add or update the relevant
scenario under `checks/` so the behavior is exercised against the public API.

If harness coverage is not practical for a feature, document why in the PR or
development note and keep the unit coverage explicit about the gap.
