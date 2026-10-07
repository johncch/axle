# Native single-binary build for the CLI

Working note for `pnpm run build:binary`: a Bun-compiled executable of
`axle-cli` that runs without Node or npm on the user's machine. This note
covers the build itself; distribution (GitHub Releases, Homebrew tap, a
`curl | sh` installer, `axle upgrade`) is not built yet and will get its own
note when it lands. npm (`npm i -g @fifthrevision/axle-cli`) stays as an
install path; the binary is an additional channel.

## Runtime choice: Bun over Node SEA

Two candidates produce a single executable from this codebase. Node SEA
embeds a script into a copy of the real `node` binary, so the shipped
runtime is the one the tests ran on. But SEA still requires a CommonJS
entry, and the dependency tree here is ESM-only (ink, chalk, the SDKs);
converting it means shimming every `import.meta.url` inside dependencies
and maintaining a second bundle format. Cross-compilation is also manual:
one `node` download per target, `postject` to inject, and macOS signing
from a Linux runner needs a third-party tool.

Bun's `build --compile` takes the existing `dist/cli.js` as-is, bundles
every module it reaches, and appends the result to a Bun runtime for any
`--target` from one host. Output is ~64 MB (arm64 macOS), ad-hoc signed
automatically. The cost is that the binary runs on Bun, not Node, so Node
compatibility has to be demonstrated rather than assumed.

Settled: Bun. The spike that decided it ran, from the compiled binary:
`--version`, `--help`, `info`; the `simple-tool-use` job (Anthropic SDK
streaming plus a local tool); the `mcp-stdio` job (spawns `npx tsx` and
speaks JSON-RPC over its pipes); and a job under a pseudo-TTY to exercise
ink's live redraw. All behaved identically to Node. Startup is ~100 ms
against ~300 ms for `node dist/cli.js`, since no module resolution touches
the filesystem. Cross-compiling `bun-linux-x64` from macOS took under a
second after the one-time runtime download.

Rejected: Node SEA, for the CJS constraint above; revisit if Bun develops
an incompatibility the spike missed. Rejected: an install script that
downloads a portable Node and installs the npm tarball into `~/.axle`. It
avoids compiling but ships two runtimes' worth of moving parts for the same
user-facing result.

## What gets bundled

Bun's bundler starts at `dist/cli.js` and follows every static `import`:
`@fifthrevision/axle` through the workspace symlink and core's `exports`
to `packages/axle/dist`, then the Anthropic, OpenAI, Gemini and MCP SDKs,
ink, react, and so on down to leaves — 1403 modules.

That core resolution was not always true. The repo used to map
`@fifthrevision/axle` to core's `src` through tsconfig `paths` so that tsc,
vitest and tsx could see source without a build. Bundlers honour `paths`
as a project-wide alias on every file under the tsconfig, `dist/cli.js`
included, and Bun bundles TypeScript natively — so from the first spike the
binary had quietly been bundling core from source, and built fine with
core's `dist` deleted. The alias was the exotic part, not Bun.

Settled: core's `package.json` declares an `axle-source` export condition
(`"axle-source": "./src/index.ts"` ahead of `types`/`import`). Tools that
want source opt in — `customConditions` in `tsconfig.base.json`,
`tsx --conditions=axle-source` in the `start`/`checks` scripts and the e2e
test's spawn, `ssr.resolve.conditions` in the CLI's vitest config —
and everything else, Bun and npm consumers included, resolves to `dist`
by ordinary rules. No `paths`, no vitest alias, no bundler plugin for
core; building the binary without core's `dist` now fails loudly.

Rejected: a resolver plugin in the build script pinning the two core
entries to `../axle/dist/*.js`. It worked, but it fought the alias in one
tool instead of removing the alias. Rejected: naming the condition
`source`. `eventsource-parser`, a transitive dependency of the SDKs,
declares its own `source` condition pointing at its TypeScript, and Node
tried to load that under vitest. Custom conditions share one namespace;
the name must be unique to the project.

Two vitest details: Vite 7 scopes conditions per environment and vitest
runs tests in the SSR one, so the setting is `ssr.resolve.conditions`,
not `resolve.conditions`; and setting it replaces Vite's defaults, so the
list restates `module`, `node` and `development|production` (`vite` is not
importable from the package under pnpm, so `defaultServerConditions`
cannot be spread in). They are concatenated into one JavaScript blob
inside the executable. The versions frozen in are whatever `pnpm-lock.yaml`
resolved at build time; nothing is fetched on the user's machine and there
is no `node_modules` beside the binary. `import pkg from "../package.json"`
is resolved at build time too, which is why `--version` works.

What is not bundled is anything reached only at runtime by a path the
bundler cannot see: a dynamic `import(variable)`, a `readFileSync(new
URL(..., import.meta.url))`, or a process the user's recipe spawns. The
`mcp-stdio` example's `npx tsx …` is the user's MCP server, not an axle
dependency; it needs `npx` on the user's machine exactly as it does under
Node.

## The one bundling snag: ink's devtools import

ink's reconciler does, behind `if (process.env['DEV'] === 'true')`, an
`await import('./devtools.js')`, and that file statically imports
`react-devtools-core` — an optional peer nobody installs. Node never
evaluates the branch. Bun's bundler inlines dynamic imports into the single
bundle, so it tries to resolve the package and fails.

Two obvious fixes do not work. `--external react-devtools-core` leaves the
import in place as a runtime `import`, which Bun hoists to the top of the
bundle and evaluates eagerly: the binary dies on startup with "Cannot find
package". `--define process.env.DEV=…` would let the bundler fold the `if`
to `false` and drop the branch, but ink uses bracket access
(`process.env['DEV']`) and `--define` keys must be dotted identifiers.

This is a known ink-plus-bundler problem, not a Bun one: ink#650 (Bun,
closed not-planned), ink#886 (a 6.8.0 regression where the `DEV` check
moved into a function and even dotted `define` stopped folding it; 7.x has
the inline check back), and several projects that compile with Bun report
the identical `--external` startup failure. The community fix is to add
`react-devtools-core` as a devDependency so it simply bundles; one project
measured the binary cost at ~0.7 MB.

Settled: a bundler plugin in `scripts/build-binary.mjs` that resolves
`react-devtools-core` to an empty module. The branch stays in the bundle
and remains dead at runtime. The script is `.mjs` rather than `.ts` so the
`tsc --noEmit` does not need Bun's type definitions; it is run with
`bun`, never with Node.

Rejected: the devDependency route. It is the well-trodden path and cheap
in bytes, but it declares a debugging tool nobody here uses, adds its
`ws` and `shell-quote` to every install, and ships code that can never
run. The plugin costs ten lines and zero bytes; switch to the
devDependency if the plugin ever obstructs an ink upgrade.

ink's other `import.meta.url` use (reading its own `package.json` to
report its version) is behind the same `DEV` guard and is never reached.

## Two compiled-mode fixes in the CLI

`axle info` printed `node v26.3.0` from the binary: Bun sets
`process.version` to the Node release it claims compatibility with. The
runtime line now reads `process.versions.bun` first and prints
`bun 1.4.2`, so bug reports say which runtime they came from.

`resolveRelaunchArgv` in `src/cli/schedule/reconcile.ts` wrote
`[execPath, ...execArgv, resolve(argv[1])]` into launchd plists. In a
compiled binary `execPath` is the executable and `argv[1]` is the virtual
path `/$bunfs/root/axle`, so a scheduled job would have been launched as
`axle /$bunfs/root/axle --scheduled …`. When `argv[1]` starts with
`/$bunfs/`, the relaunch command is now `[execPath]` alone. A consequence
worth remembering when the upgrade path exists: replacing the binary in
place changes what every registered schedule runs next.

## Installing over a running binary

`pnpm run install:binary` copies the build to `~/bin/axle`. The copy is
staged as `axle.tmp` and renamed into place rather than written over the
existing file. macOS caches code-signature validity per inode; rewriting
a signed executable in place can leave the cache stale and the next launch
dies with `Killed: 9` (golang/go#42684, fixed in Go the same way).

The hazard did not reproduce when tested: Bun's `copyFileSync` happened to
replace the destination inode for the 64 MB binary, though it keeps the
inode for small files and Node's keeps it at any size. That safety is an
undocumented size heuristic, so the rename makes it explicit. It is also
the mechanism `axle upgrade` will need for atomic replacement.

## Testing the binary

Development stays on Node (`pnpm start`, vitest); the binary is a packaging
artifact and is tested as one. The unit suite does not run under Bun — the
failures Bun could introduce are in runtime APIs (raw-mode stdin, child
process pipes, streaming fetch), which unit tests under Node cannot
witness and `bun test` would run against a different runner anyway.

What catches Bun regressions is exercising the compiled binary:

- Smoke commands that need no provider: `--version`, `--help`, `info`.
- `scripts/run-example-jobs.sh` and the `checks/` publish smoke set, run
  against the binary rather than `tsx src/cli.ts`, before a release.
- Pinning the Bun version used to build, so the runtime that ships is the
  one that was exercised; bumping it is a deliberate change that reruns the
  above.

Only the first is scripted today; the others are run by hand. Wiring the
binary into `run-example-jobs.sh` and `checks/` as an alternate entry point
belongs to the distribution work.
