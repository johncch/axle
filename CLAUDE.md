# Package Manager

**This project uses pnpm, not npm.**
- Always use `pnpm` commands instead of `npm`
- Never commit `package-lock.json` (it's gitignored)

# Build, Test & Lint Commands

- Build: `pnpm run build` (pkgroll with clean-dist and minify)
- Build (dev): `pnpm run build-dev` (pkgroll with clean-dist, no minify)
- Build (watch): `pnpm run build:watch` (for npm link development scenarios)
- Test all: `pnpm test`
- Test single: `pnpm test -- path/to/file.test.ts` or `pnpm test -- -t "test name pattern"`
- Test watch: `pnpm test -- --watch`
- Start: `pnpm start` (runs with tsx)
- Release: `pnpm run release` (runs tests, builds, then npm version)

# Code Style Guidelines

- **Imports**: ES modules, use `node:` prefix for Node.js modules
- **Formatting**: 2-space indentation, Prettier with organize-imports plugin
- **Types**: Strong TypeScript typing, explicit function parameters and returns. This project uses **Zod v4** (not v3).
- **Naming**:
  - PascalCase for classes and interfaces (e.g., `Agent`, `Instruct`, `MCP`)
  - camelCase for functions and variables
- **Error Handling**: Use descriptive error messages, utilize custom error classes in `src/errors/`
- **Testing**: Vitest with descriptive test names, organize with nested describe blocks

# Repository Structure

- `src/`: Source code
  - `core/`: Agent, Instruct, compile, parse
  - `providers/`: LLM provider integrations
    - `anthropic/`, `openai/`, `gemini/`, `chatcompletions/`
    - `stream.ts`, `generate.ts`, `generateTurn.ts` — lower-level primitives
  - `mcp/`: Model Context Protocol adapter
  - `messages/`: Conversation history and message types
  - `tools/`: LLM-callable tools (brave, calculator, exec, read-file, write-file, patch-file)
  - `tracer/`: Tracing/logging with pluggable writers
  - `errors/`: Custom error classes
  - `utils/`: Helper functions
  - `cli/`: CLI implementation
    - `configs/`: Configuration handling
    - `runners.ts`, `tools.ts`, `ledger.ts`
- `tests/`: Test files (mirrors src/ structure)
- `examples/`: Sample job definitions and scripts
- `scripts/`: Utility scripts
- `docs/`: Documentation
  - `development/`: Dated design decision documents
- `dist/`: Build output (generated, not checked in)

# Build Notes

- **`dist/` is not checked in** — It's generated during build and ignored by git
- **`prepare` script** — Runs `npm run build` automatically when installing from git URLs
- **npm link workflow** — Use `pnpm run build:watch` for live rebuilding during development

# Key Concepts

- **Agent**: Primary interface. Owns provider, model, system prompt, tools, and conversation history. `send()` accepts a string or Instruct.
- **Instruct**: Rich message with structured output (Zod schema), file attachments, and variable substitution.
- **Providers**: `anthropic()`, `openai()`, `gemini()`, `chatCompletions()` — factory functions that create provider instances.
- **`stream()` / `generate()`**: Lower-level primitives for tool-loop execution without conversation management. Agent uses `stream()` internally.
- **Tool**: Object with name, description, Zod schema, and `execute` function. Built-in tools: `braveSearchTool`, `calculatorTool`, `execTool`, `readFileTool`, `writeFileTool`, `patchFileTool`.
- **MCP**: Adapter for connecting to Model Context Protocol servers (stdio and HTTP transports).
- **Tracer**: First-class concept. All functions that do work must accept and use the tracer interface. Structured tracing with span-based logging and pluggable writers.