# Package Manager

**This project uses pnpm, not npm.**

- Always use `pnpm` commands instead of `npm`
- Never commit `package-lock.json` (it's gitignored)

# Build, Test & Lint Commands

- Build: `pnpm run build` (tsdown with clean-dist and minify)
- Build (dev): `pnpm run build-dev` (tsdown without minify)
- Build (watch): `pnpm run build:watch` (for npm link development scenarios)
- Test all: `pnpm test`
- Test single: `pnpm test -- path/to/file.test.ts` or `pnpm test -- -t "test name pattern"`
- Test watch: `pnpm test -- --watch`
- Start: `pnpm start` (runs with tsx)
- Release: `pnpm run release -- <version>` (runs tests, builds, versions packages, commits, and tags)

# Code Style Guidelines

- **Imports**: ES modules, use `node:` prefix for Node.js modules
- **Formatting**: 2-space indentation, Prettier with organize-imports plugin
- **Types**: Strong TypeScript typing, explicit function parameters and returns. This project uses **Zod v4** (not v3).
- **Naming**:
  - PascalCase for classes and interfaces (e.g., `Agent`, `Instruct`, `MCP`)
  - camelCase for functions and variables
- **Error Handling**: Use descriptive error messages, utilize custom error classes in `src/errors/`
- **Testing**: Vitest with descriptive test names, organize with nested describe blocks

# Commenting style guides

- No narrating comments — a comment that states what the code states goes
- Only create JSDoc style comments for exported main objects; private
  methods and internals get none
- Caveats, invariants, and design rationale live in `docs/architecture/*`,
  not inline. An inline comment that repeats what an architecture doc
  records is a defect — delete it, or move the caveat into the doc if it
  isn't recorded yet
- In tests, comments exist only to decode magic values an assertion can't
  explain on its own (e.g. why a length is 5); comments that restate the
  test name or a readable assertion go

# Repository Structure

- `packages/axle/`: Core runtime package
  - `src/core/`: Agent, Instruct, compile, parse
  - `src/providers/`: LLM provider integrations
  - `src/mcp/`: Model Context Protocol adapter
  - `src/messages/`: Conversation history and message types
  - `src/tools/`: Tool interfaces and registry
  - `src/turns/`: Turn presentation types, events, accumulator
  - `src/tracer/`: Tracing/logging with pluggable writers
  - `src/errors/`: Custom error classes
  - `src/utils/`: Helper functions
  - `tests/`: Core package tests
- `packages/axle-cli/`: CLI harness package
  - `src/cli.ts`: CLI entrypoint
  - `src/cli/`: YAML loading, runners, tool factory, ledger
  - `src/tools/`: CLI local workflow tools (calculator, exec, read-file, write-file, patch-file)
  - `src/memory/`: CLI memory implementation
  - `src/store/`: CLI local file store
  - `tests/`: CLI package tests
- `examples/`: Sample job definitions and scripts
- `scripts/`: Utility scripts
- `docs/`: Documentation
  - `architecture/`: Normative per-subsystem design docs (see Documentation below)
  - `development/`: Dated working notes, one per change (frozen)
- `dist/`: Build output (generated, not checked in)

# Build Notes

- **`dist/` is not checked in** — It's generated during build and ignored by git
- **`prepare` script** — Runs `pnpm run build` automatically when installing from git URLs
- **npm link workflow** — Use `pnpm run build:watch` for live rebuilding during development

# Key Concepts

- **Agent**: Primary interface. Owns provider, model, system prompt, tools, and conversation history. `send()` accepts a string or Instruct.
- **Instruct**: Rich message with structured output (Zod schema), file attachments, and variable substitution.
- **Providers**: `anthropic()`, `openai()`, `gemini()`, `chatCompletions()` — factory functions that create provider instances.
- **`stream()` / `generate()`**: Lower-level primitives for tool-loop execution without conversation management. Agent uses `stream()` internally.
- **Tool**: Object with name, description, Zod schema, and `execute` function. Core exports tool interfaces and `ToolRegistry`; CLI owns local workflow tool implementations.
- **MCP**: Adapter for connecting to Model Context Protocol servers (stdio and HTTP transports).
- **Tracer**: First-class concept. All functions that do work must accept and use the tracer interface. Structured tracing with span-based logging and pluggable writers.

# Documentation

Documentation is layered by authority; each genre has one job:

- **`docs/architecture/*` is normative** for its subsystem — the invariants
  and the design rationale, with dated rejected alternatives. Code and tests
  are built against these docs; doc/code divergence is a defect to fix, not
  ignore. Maintenance is same-diff, never a separate cycle: a change that
  alters a recorded invariant updates the doc in the same change; a design
  debate that settles a new direction appends its decision and rejected
  alternatives with a date. Only create one for a subsystem with a settled
  design worth defending — an architecture doc without a design debate
  behind it is ceremony.
- **`docs/terminology.md` is normative for vocabulary.** Name new units of
  work or state there first.
- **`README.md` is derived, never authoritative** — usage-level, and where
  it describes a subsystem covered by an architecture doc, it must agree
  with (and should be regenerable from) that doc. When changing public API
  signatures (Agent, Instruct, MCP, providers, tools, streaming events,
  CLI/YAML schema), update `README.md` to match.
- **`docs/<version>-migration.md`** (frozen): breaking-change deltas per
  release. When building a new feature with breaking changes, write the
  migration entry; ask the user which version to target.
- **`docs/development/*`** (frozen): dated working notes for a single
  change. Historical record — never updated after the fact.
