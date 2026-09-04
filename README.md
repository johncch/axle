# Axle

Axle is a TypeScript library for building multi-turn LLM agents, and a CLI
task runner built on it.

## Packages

| Package                                         | What it is                                                     |
| ----------------------------------------------- | -------------------------------------------------------------- |
| [`@fifthrevision/axle`](packages/axle/)         | The Typescript library for building reliable agents            |
| [`@fifthrevision/axle-cli`](packages/axle-cli/) | The CLI harness for running repeatable or one-off AI workloads |

# A brief history

Axle started as a TypeScript native CLI task runner. Back then, context windows
were small and tool use were limited and there was a lot of utility in building
workflows that chained AI calls and other API calls together. The early versions
of `Instruct` were heavily inspired by DSPy.

It was called Axle because I imagined it to be like axles in cars. It's the
central spoke that connects the engine to where rubber meets the road.

As models got better at reasoning and tool use, a lot of the early abstractions
became unnecessary. Instead, I find myself building and rebuilding primitives to
interact with LLM APIs in more and more sophisticated ways.

Thus, Axle the library was born. Today, Axle is shared not just between the CLI, [Sunnyday](https://www.sunnyday.run), and [Axle Code](https://github.com/johncch/axle-code), but also in various other projects and experiments.

# Axle (TypeScript Library)

```bash
npm install @fifthrevision/axle        # the library
```

```typescript
import { Agent, anthropic } from "@fifthrevision/axle";

const agent = new Agent({ provider: anthropic(), model: "claude-sonnet-5" });
const result = await agent.send("What should I name my new library?").final;
```

# Axle CLI

```bash
npm install -g @fifthrevision/axle-cli # the CLI
axle                       # interactive chat
axle -j recipe.yml         # run a checked-in recipe
axle batch -j recipe.yml   # one isolated session per input
```

Each package README carries its full usage documentation.

## Repository

- `packages/axle` — core runtime · `packages/axle-cli` — CLI harness
- `docs/architecture/` — normative per-subsystem design docs (invariants,
  dated decisions, rejected alternatives)
- `docs/<version>-migration.md` — the library's breaking-change deltas per
  release; the CLI's release notes live in
  [its changelog](packages/axle-cli/CHANGELOG.md)
- `docs/terminology.md` — normative vocabulary
- `examples/` — runnable scripts and job definitions

## Development

This repo uses **pnpm**.

```bash
pnpm install
pnpm run check   # typecheck + tests + build (mirrors CI)
pnpm start       # run the CLI from source
```
