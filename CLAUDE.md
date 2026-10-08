# Package Manager

**This project uses pnpm, not npm.**

- Always use `pnpm` commands instead of `npm`
- Never commit `package-lock.json` (it's gitignored)

# Build, Test & Lint Commands

- Build: `pnpm run build` (tsdown with clean-dist and minify)
- Build (dev): `pnpm run build-dev` (tsdown without minify)
- Build (watch): `cd packages/axle && pnpm build:watch` (only for a consumer that needs built output; linked TypeScript projects don't)
- Package (binary): `cd packages/axle-cli && pnpm package` (Bun single executable at `dist-bin/axle`; requires `bun`; stamped as a dev build unless HEAD is the clean release tag)
- Install (binary): `cd packages/axle-cli && pnpm package:install`, or `pnpm cli:install` from the root (packages, then copies the binary to `~/bin/axle`)
- Test all: `pnpm test` (vitest projects over `packages/*`)
- Typecheck: `pnpm run typecheck` (`pnpm -r typecheck` over every workspace package, including `checks/` and `examples/`; CI runs this — vitest and tsdown don't typecheck tests)
- Full CI mirror: `pnpm run check` (typecheck + test + build, same order as CI)
- Test single: `pnpm test path/to/file.test.ts` or `pnpm test -t "test name pattern"` (no `--`; pnpm would pass it through literally and vitest runs everything)
- Per package: `cd packages/<name>` then `pnpm test`, `pnpm typecheck`, `pnpm build` — each package has its own `tsconfig.json` and `vitest.config.ts`
- Test watch: `pnpm test -- --watch`
- Start: `pnpm start` (runs with tsx)
- Example jobs: `scripts/run-example-jobs.sh [job files...]` (runs `packages/axle-cli/examples/*` sequentially against real providers; starts the HTTP MCP server)
- Release: `pnpm run release -- <version>` (runs tests, builds, versions packages, commits, and tags)

# Working with Humans

- Let's document major design decisions in the docs/ folder so we can have something to refer to and track how the ideas in the codebase have evolved.
- If a feature work touches a core concept, ask the human if it needs to be a core architecture doc or update an existing one
- If a feature work is a new feature or a revamp, ask the human if it wants a new entry under docs/development (most likely yes).

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
  - `src/turns/`: Turn presentation types, events, transcript
  - `src/tracer/`: Tracing/logging with pluggable writers
  - `src/errors/`: Custom error classes
  - `src/utils/`: Helper functions
  - `tests/`: Core package tests
  - `examples/`: Runnable library scripts, the wordcount MCP server (`mcps/`), and shared fixture files (`data/`); run from the repo root
- `packages/axle-cli/`: CLI harness package
  - `src/cli.ts`: CLI entrypoint
  - `src/cli/`: YAML loading, runners, tool factory, ledger
  - `src/tools/`: CLI local workflow tools (exec, read-file, write-file, patch-file)
  - `tests/`: CLI package tests
  - `examples/`: Example job definitions; run from the repo root
- `checks/`: Live provider checks (`pnpm run checks`) and wire captures (`checks/captures/`) — a private workspace package, same root-cwd rule
- `scripts/`: Release and workflow scripts (`release.mjs`, `cut-release.mjs`, `run-example-jobs.sh`)
- `docs/`: Documentation
  - `architecture/`: Normative per-subsystem design docs (see Documentation below)
  - `development/`: Dated working notes, one per change (frozen)
- `dist/`: Build output (generated, not checked in)

# Build Notes

- **Root `package.json` is orchestration only** — fan-out scripts (`build`, `test`, `typecheck`, `check`), release tooling, and `start`/`checks` (which need root cwd). Its devDependencies are prettier, tsx and vitest. A dependency used by code in a package belongs in that package's `package.json`, including `checks/` and `examples/`.
- **Core resolves to source inside the repo, dist in the tarball** — core's `exports` point at `src/*.ts`; `publishConfig.exports` holds the `dist` entries and `pnpm pack` swaps them in. tsx, tsc, vitest and tsdown all see source with no flags and no build. Nothing in the repo reads core's `dist`: the CLI build bundles core in (`deps.alwaysBundle` in its tsdown config, with types left external), so `dist/cli.js` is self-contained and the binary build only needs the CLI's own `pnpm build`. Core's runtime dependencies are therefore listed in the CLI's `package.json` too; keep the two lists in step. Never alias the package name with tsconfig `paths`.
- **`dist/` is not checked in** — It's generated during build and ignored by git
- **Linking into another project** — `cd packages/axle && pnpm link` (the root is a private workspace package, not the library). The link resolves to `src`, so a TypeScript project (tsx, vitest, Vite) needs no build and no watcher. Plain Node can't run the linked source; a consumer that needs built output installs a tarball from `pnpm --filter @fifthrevision/axle pack` instead, which applies `publishConfig`. Git-URL installs also skip `publishConfig` and are not a supported pathway.

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
- **READMEs are derived, never authoritative** — usage-level, and where
  they describe a subsystem covered by an architecture doc, they must agree
  with (and should be regenerable from) that doc. The root `README.md` is a
  lean project front page; full usage docs live in each package's README
  (`packages/axle/README.md` for the library, `packages/axle-cli/README.md`
  for the CLI — these are the npm-facing pages). When changing public API
  signatures (Agent, Instruct, MCP, providers, tools, streaming events,
  CLI/YAML schema), update the owning package README to match.
- **`docs/<version>-migration.md`** (frozen): breaking-change deltas per
  release **for the Axle library only** — API diffs for consumers with call
  sites. When building a new feature with breaking changes, write the
  migration entry; ask the user which version to target.
- **`packages/axle-cli/CHANGELOG.md`**: the CLI's release notes — it is a
  separate product with recipe/flag-level changes, not API call sites.
  Breaking changes lead each entry.
- **`docs/development/*`** (frozen): dated working notes for a single
  change. Historical record — never updated after the fact.
