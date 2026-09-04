# Axle CLI: invocation grammar and sessions

**Status**: current · **Last design revision**: 2026-09-03 (0.31 branch)

This document is normative for the CLI's invocation grammar, session model,
renderer boundary, and configuration layering. Code and tests are built
against it; divergence is a defect. State ownership is defined in
[agent-state.md](./agent-state.md); compaction in
[compaction.md](./compaction.md); vocabulary in
[terminology.md](../terminology.md).

## Invariants

1. **A recipe is a saved partial application of an invocation.**
   Conceptually `axle(...recipe, ...argv)`: the job YAML splays into the
   parameters an invocation could have said, and the command line overrides
   selectively. Resolution follows one monotone gradient, most-ambient to
   most-specific:

   ```
   env / credentials  <  cli.yaml defaults  <  recipe (YAML)  <  command line
   ```

   The mirror is one-way: everything expressible at the command line has a
   home in the recipe (including verb selection — a `batch:` block means
   "add the batch verb to the call"), but the CLI owes no flag-parity in
   return. A recurring job's full memory lives in its checked-in YAML;
   command-line overrides are the deliberate, occasional exception.

2. **Verbs select the machine; flags parameterize it.** The kernel is the
   session runner — bare `axle` (chat), `-j` (recipe), `-m` (one-shot),
   `-i` (continue after the task). Verbs are distinct machines composed on
   top of it, each with its own signature:

   | Verb           | Signature              |
   | -------------- | ---------------------- |
   | `axle batch`   | (recipe, inputs)       |
   | `axle resume`  | (session id, message?) |
   | `axle setup`   | ()                     |
   | `axle cleanup` | ()                     |

   The recipe↔invocation mirror governs only the kernel. Mode collisions
   are impossible by construction — there is no `--job`/`--session`
   exclusion matrix because modes are not flags.

3. **Every run is a session.** Chat, one-shot, recipe run, and every
   individual batch item persist the same shape — `AgentDefinition` +
   `agent.snapshot()` + `Transcript.turns` + cwd — to
   `~/.axle/sessions/cli/<id>.json`, saved on every exit path. Anything
   that produced a session can be re-entered with `axle resume <id>`.
   Sessions accumulate; `axle cleanup` deletes by age window. There is no
   automatic retention. Sessions compact automatically near the context
   window (policy: `createSessionCompaction` — ~80% threshold, ~1000-word
   summary, thinking inherited from the recipe; `compaction: false` opts a
   recipe out); the mechanism is core's, per
   [compaction.md](./compaction.md).

4. **Batch is map(recipe, inputs), composed on the kernel.** One isolated
   session per input, run mechanically — no orchestrator model in the loop,
   so completeness is checkable, not trusted. Inputs resolve as: positional
   arguments to the verb → the recipe's `batch:` block → an interactive
   prompt (verb only — bare `axle -j` honors the block and never prompts).
   A project-local ledger (`.axle/batch.jsonl`) records every item run,
   keyed `(job name, input)` with a content-only hash. Skipping is opt-in:
   `--incremental` (or `incremental: true` in the block; `--no-incremental`
   overrides) skips completed inputs whose content is unchanged. **Input
   changes are the ledger's problem; recipe changes are the user's** — a
   model/task/system edit never auto-invalidates. A plain run is the
   force-fresh gesture: it re-runs everything and rewrites the ledger.
   Session ids surface on settled item lines and in the ledger —
   `axle resume <id>` (unique prefixes accepted) continues any item,
   failed or not.

5. **Isolation is batch's feature, not a capability workaround.** Large
   contexts and file tools let a single session iterate over many files;
   batch exists for when items must be _independent_: no
   cross-contamination between items (often a correctness requirement —
   per-item assessment, grading, triage), uniform per-item quality, flat
   per-item cost, and mechanical completeness. When cross-item awareness is
   wanted (synthesis, comparison), that is precisely not-batch — the
   natural pipeline is a batch pass then an ordinary session over its
   outputs. Because batch is a verb plus a block key plus a ledger, it is
   removable without a scar on the session kernel if it ever stops earning
   its place.

6. **Resume replays; it does not compose.** The stored definition is
   authoritative — no provider/model overrides on resume. The session's
   original cwd is recorded and warned about on mismatch, never chdir'd to.

7. **Two output channels; renderers are folds, not deciders.** Everything
   on screen is either _transcript_ (the model's conversation: `TurnEvent`s
   folded into the host-owned `Transcript`) or a _host line_
   (`info`/`success`/`warn`/`error` from the runner). The runner applies
   each event to the transcript **before** `onEvent(event, transcript)`, so
   a renderer reads settled state and holds no business logic — the same
   events replay through `renderPriorTurns` on resume. The dialect is a
   task runner, not a chat app: consola gutter glyphs (`ℹ ✔ ⚠ ✖`) for host
   lines, work lines that settle with a duration (`✔ Calculator {…}
(430ms)`), model text as unadorned stdout, and the user's `❯` as the
   only persona glyph. Render mode is fixed at launch: ink when stdin and
   stdout are both TTYs (a batch-progress variant when batch runs without
   `--verbose`), else the plain renderer — piped output reads as a frozen
   ink transcript. Under ink the terminal stays in raw mode for the whole
   session, so Ctrl-C arrives as a key event routed through the renderer's
   interrupt handler — a cooked-mode SIGINT would hit the ancestor process
   group (pnpm/tsx) and kill the tree before graceful stop could run.
   `close()` is async and paints one final frame before unmounting.

8. **Configuration layers by home; credentials are shared property.** Two
   homes — project `.axle/` and user `~/.axle/` — each may hold
   `credentials` (dotenv format) and `cli.yaml`. Credentials resolve per
   key: process env (including `.env`) → project → user; an empty string
   counts as unset and falls through. The credentials files are shared
   with sibling tools (axle-code): writers upsert individual keys and
   preserve foreign lines verbatim — never rewrite the file. `cli.yaml`
   merges user-then-project with project winning; `defaults` merge per
   key, provider profiles replace wholesale. On top of the layered
   sources, one uniform chain resolves the seat: provider name := recipe →
   `defaults.provider` → error; endpoint := `providers[name]` profile →
   built-in type → error; model := recipe → `defaults.models[name]` →
   `*_MODEL` credential → interactive picker (TTY) or error. The provider
   is never inferred from the model string.

9. **The CLI never changes directory; artifacts anchor to their scope.**
   Project-scoped state (`.axle/` config layer, the batch ledger) anchors
   to the invocation cwd, and recipe-relative paths resolve against it.
   User-scoped state (sessions, logs, user config) anchors to `~/.axle/`
   — sessions deliberately, so `axle resume` works from anywhere; the
   recorded cwd produces a warning on mismatch (invariant 6), nothing
   more.

## Decisions

- **2026-09-03 — batch invocation lives in the recipe.** `batch: {files,
concurrency}`. Rejected: `--each`/`--concurrency` flags (built and
  reversed the same day) — moving inputs to the command line splits a
  recurring job's memory into two places, and the YAML is the checked-in,
  self-documenting half. The command-line _override_ (positional inputs on
  the `batch` verb) survives because overrides are exceptional by
  definition and do not carry the job's memory.
- **2026-09-03 — resume is a verb.** Rejected: `--session` as a kernel
  flag — it required a hand-written flag-exclusion matrix and framed
  resume as a parameterization of "start a session" when it is a different
  machine (loads state, refuses composition).
- **2026-09-03 — incremental is opt-in; the ledger tracks inputs, not the
  recipe.** Rejected the same day, in order: default skip-on-rerun (silent
  staleness — a model or task edit skipped everything with no signal), and
  model-in-hash auto-invalidation (a model change does not always mean
  "re-run"; the tool cannot guess intent). Settled: the ledger is always
  written; `--incremental` is the user's explicit claim that completed,
  content-unchanged inputs stand. Staleness from recipe changes is
  user-managed — run plain to redo everything, or hand-edit the JSONL for
  selective re-runs. The word is `incremental` (a mode/property,
  make-style), deliberately not `resume` or `continue` — resume restores
  one session's state; incremental tops up a set of fresh ones. The old
  `batch.resume` key stays gone.

- **2026-09-03 — task-runner dialect for all output (AXL-20/21).**
  Rejected across one day of iteration: a chat-app persona gutter (a glyph
  in front of every line, `■` for the model), circle/quadrant spinners
  ending on a filled glyph, and decorated model text. Settled on the
  consola/tsdown family: work lines spin and settle with durations, host
  lines carry the gutter, model prose is plain stdout. The model's words
  are the product; the frame should look like tooling.
- **2026-09-02 — provider profiles replace wholesale across config
  layers.** Rejected: field-merging profiles — merging two valid endpoint
  configurations can produce a shape neither file's validation would
  accept (e.g. a `baseUrl` from one layer with an `apiKeyEnv` for a
  different service from another).
- **2026-09-02 — interactive is for steering, not a coding agent.**
  Interactive is the default entry (cowork-like for tasks with no formal
  definition); `-j` stays first-class for anything worth rerunning. `/quit`
  is the only slash command, deliberately.
- **Deferred — subagent fan-out.** Isolation-with-orchestration inside a
  recipe (core's `createAgentTool` + `parallelize`) is a different layer:
  task-level, orchestrator in the loop. It does not compete with batch's
  invocation-level mechanical map and is tracked separately.
