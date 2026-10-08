# Axle CLI: invocation grammar and sessions

**Status**: current · **Last design revision**: 2026-10-08 (AXL-73)

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

   | Verb            | Signature                                                                            |
   | --------------- | ------------------------------------------------------------------------------------ |
   | `axle batch`    | (recipe, inputs)                                                                     |
   | `axle resume`   | (session id, message?)                                                               |
   | `axle setup`    | ()                                                                                   |
   | `axle info`     | ()                                                                                   |
   | `axle explain`  | (key path?)                                                                          |
   | `axle trust`    | (`--revoke`?)                                                                        |
   | `axle cleanup`  | ()                                                                                   |
   | `axle schedule` | (recipe) · `register` (recipe) · `remove` (recipe) · `sessions` (recipe) · `list` () |

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
   window (policy: `createSessionCompaction` — ~80% threshold of the
   window; ~1000-word summary, thinking inherited from the recipe;
   `compaction: false` opts a recipe out); the mechanism is core's, per
   [compaction.md](./compaction.md). The window is resolved at every run
   start, resume included, and never stored (invariant 6): the provider's
   `contextWindow` if set (profile or inline — an endpoint fact, since a
   local server loads models below their maximum), else core's
   `ModelCatalog` (models.dev, host derived from the provider type or
   `vendor`), else an assumed 200,000. The catalog is cached at
   `~/.axle/cache/models.json`; a run reads the cache and refreshes it in
   the background when it is a day old, `axle info` awaits the refresh, and
   no run ever waits on or fails for the network. `axle info` prints each
   provider's window with its source and the matched catalog id, so a
   best-effort match is visible.

4. **Batch is map(recipe, inputs), composed on the kernel.** One isolated
   session per input, run mechanically — no orchestrator model in the loop,
   so completeness is checkable, not trusted. Inputs resolve as: positional
   arguments to the verb → the recipe's `batch:` block → an interactive
   prompt (verb only — bare `axle -j` honors the block and never prompts).
   A project-local ledger (`.axle/batch.jsonl`) records every item run,
   keyed `(job scope, input)` with a content-only hash — the scope is the
   recipe's `name`, else its path relative to the project root, never a
   shared constant (unnamed recipes would cross-skip under
   `--incremental`). Skipping is opt-in:
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

6. **A session freezes the conversation and the recipe; it names its
   configuration.** The stored definition records what the recipe said, as
   written: `system`, `request`, `tools` when listed, `providerTools`,
   `mcps`, `compaction`, an inline `provider` object, and the resolved
   `model` (whichever layer chose it — the history was produced by that
   model). What the recipe _named_ or _left out_ is stored as a reference or
   a gap and resolved against the current configuration on every run,
   resume included: a provider name (`provider: ollama`) is saved as the
   name and finds its profile again; an absent `tools:` is saved as absent
   and takes the current `defaults.tools`; `apiKeyEnv` is read from the
   environment. No provider profile, default, or key is ever copied into a
   session file, and a recipe's inline provider accepts `apiKeyEnv` but not
   `apiKey` — anything check-in-able never holds a secret. Resume therefore
   needs no recipe file and accepts no provider/model overrides from the
   command line, but it does follow an edited profile or default. The
   session's original cwd is recorded and warned about on mismatch, never
   chdir'd to.

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
   only persona glyph. Under ink an agent text part, streaming or
   settled, and the summary on a settled thinking line are drawn as
   terminal markdown (core's `renderTerminalMarkdown`: blocks separated
   by a blank line, bold headings, yellow inline code, fenced code behind
   a dim `│` gutter with no language label, plain list markers, tables as
   padded columns under a dim rule, no boxes). The live tail is
   the last lines of the rendered text, so a style flips in place when a
   closing marker arrives; that is accepted over a screen of raw
   asterisks. The plain renderer shows raw text: it streams deltas and
   never reprints, and a piped log should carry what the model said, not
   ANSI. Render mode is fixed at launch: ink when stdin and
   stdout are both TTYs (a batch-progress variant when batch runs without
   `--verbose`), else the plain renderer — piped output reads as a frozen
   ink transcript. Under ink the terminal stays in raw mode for the whole
   session, so Ctrl-C arrives as a key event routed through the renderer's
   interrupt handler — a cooked-mode SIGINT would hit the ancestor process
   group (pnpm/tsx) and kill the tree before graceful stop could run.
   `close()` is async and paints one final frame before unmounting.
   Questions the host asks (`setup`, `cleanup`, the missing-model fallback)
   speak the GitHub CLI dialect: a green `?` before the question, the
   answer echoed in cyan on the same line once given, a `>` cursor for
   lists, `y`/`n` answering a confirm without Enter. They are rendered over
   `@clack/core`'s prompt state machines (`src/ui/ask.ts`); the
   `@clack/prompts` theme — a guide bar down the left, diamond step
   markers, radio circles — was dropped 2026-10-04 because it reads as a
   scaffolding wizard, not a task runner, and its glyphs are not
   configurable.

8. **Configuration layers by home; credentials are shared property.** Two
   homes — project `.axle/` and user `~/.axle/` — each may hold
   `credentials` (dotenv format) and `cli.yaml`. Credentials resolve per
   key: process env → project → user; an empty string counts as unset and
   falls through. The working directory's `.env` is not read (dropped
   2026-10-08): it was the one project input outside `.axle/`, and a host
   project's own `.env` silently overrode the user's credentials. The
   credentials files are shared with sibling tools (axle-code): writers
   upsert individual keys and preserve foreign lines verbatim — never
   rewrite the file. `cli.yaml` merges user-then-project with project
   winning; `defaults` merge per key, provider profiles replace wholesale.
   On top of the layered sources, one uniform chain resolves the seat:
   provider name := recipe →
   `defaults.provider` → error; endpoint := `providers[name]` profile →
   built-in type → error; model := recipe → `defaults.models[name]` →
   `*_MODEL` credential → interactive prompt (TTY) or error. The provider
   is never inferred from the model string. The endpoint step runs on every
   invocation, resume included (invariant 6); the model step runs once, at
   the run that creates the session.

9. **The CLI never changes directory; artifacts anchor to their scope.**
   Project-scoped state (`.axle/` config layer, the batch ledger) anchors
   to the invocation cwd, and recipe-relative paths resolve against it.
   User-scoped state (sessions, logs, user config) anchors to `~/.axle/`
   — sessions deliberately, so `axle resume` works from anywhere; the
   recorded cwd produces a warning on mismatch (invariant 6), nothing
   more.

10. **A schedule is a recipe property; the OS is its registrar, never its
    memory.** A `schedule:` block declares recurrence next to the task it recurs, in
    one of two shapes that are never merged. `every` is a fixed elapsed
    interval, `<positive integer><s|m|h|d>`, a day being 24 hours; the
    floor is 60 seconds and the ceiling is what a signed 32-bit backend
    interval holds. `at` is one `HH:MM` or a list of them in the machine's
    local time, optionally restricted by `on` to a list of weekdays
    (`mon`…`sun`); there is no timezone field because the registrar
    evaluates local time and a field it cannot honor would lie. The two
    differ in what a missed firing means: an interval missed during sleep
    is skipped, a clock time missed during sleep runs once on wake. Cron
    expressions, day-of-month, and one-shot schedules are deferred and
    take further distinct fields, not an overloaded `every`. Plain `-j` is a pure run and never touches the
    registrar: it prints one read-only state line (declared but not
    registered, scheduled with its last run, or drifted — the recipe's
    interval changed or its block was removed while a registration
    remains). `axle schedule -j` _reconciles_ the registration (create,
    update, restore, or no-op — deterministic, independent of prior state)
    and then runs once in the foreground, so a `1d` schedule is proven now
    rather than a day later; `axle schedule register -j` reconciles only
    and, like every management subcommand, exits before provider
    resolution or any agent machinery. `-j` means "run this recipe"
    everywhere it appears bare; the verb wraps that run with registration.
    An update states what changed (`every 1h → at 09:00 on mon,fri`,
    `cwd a → b`) and every apply names the next firing (`in 1h`,
    `Mon 09:00`), and a record that matches but whose OS registration is
    gone is re-applied rather than trusted.
    The registrar is an injected `ScheduleBackend` (`apply`, `remove`,
    `isLoaded`) behind
    a platform lookup; only macOS `launchd` ships. Everything above the
    backend — identity, records, reconciliation, argv, presentation — is
    OS-neutral, and a second backend adds a `BackendBinding` member and an
    adapter, nothing else.

    _Identity_ is the recipe's canonical absolute path: the same file is an
    update, a moved file is a new schedule and the old one is never removed
    silently. The path is the only handle the user ever sees — every
    `schedule` subcommand takes `-j <recipe>`, and a recipe that no longer
    exists is matched by its recorded path so it can still be removed. The
    derived id (16 hex chars of the path's sha256) names the record, the
    launchd label, and the log files, and appears in no message. _State_ is one versioned JSON
    record per schedule at `~/.axle/schedules/<id>.json` (0600), holding the
    desired registration (name, recipe path, install cwd, interval, the
    shell-free occurrence argv, captured `PATH`, log paths) and the backend
    binding — never task text, provider config, arbitrary env, or
    credentials; a firing resolves those exactly as a foreground run does.
    The record is committed only after the backend succeeds: a failed first
    apply leaves nothing, and a failed update keeps the previous record and
    re-applies the previous registration so the OS never runs ahead of what
    the record says.

    An _occurrence_ is the scheduler re-entering this same CLI build:
    `[execPath, ...execArgv, entry] -j <abs recipe> --renderer plain --no-log
--scheduled <id>`. The marker bypasses reconciliation and prompts and otherwise takes the
    ordinary `-j` path — one fresh session, or
    one per input for a `batch:` recipe — re-reading the recipe every time,
    so task/model/tool edits need no re-registration while interval, cwd,
    relaunch command, or `PATH` changes reconcile on the next apply.
    The record stores the parsed _trigger_, a discriminated union of
    interval seconds or calendar times and weekdays, which the backend maps
    to `StartInterval` or one `StartCalendarInterval` entry per time and
    weekday. Either way a schedule never runs concurrently with itself, a
    firing during a still-running occurrence is missed not queued, and a
    hung occurrence suppresses later ones until it exits. Each occurrence — and the foreground run of
    `axle schedule -j`, the schedule's first — appends one line to
    `~/.axle/schedules/<id>.runs.jsonl` (start, end, status, session ids),
    which `schedule sessions` reads and `schedule list` summarizes; it is the
    discoverability channel for work that ran while nobody was watching.
    `remove` boots out the label and deletes only its own plist and record —
    recipes, sessions, CLI and schedule logs, ledgers, the runs ledger, and
    foreign LaunchAgents are untouched; re-registering the same recipe
    reclaims its id and history. A record that cannot be parsed is still
    removable, since every backend can name its artifacts from the id
    alone. An occurrence that fails before its run starts still writes a
    failed run line, and the plain-run state line degrades to a warning
    rather than aborting the run when its own files are unreadable.

11. **Local tools are on by default and run unapproved.** Chat and any
    recipe without a `tools:` key get the default set — `exec`,
    `patch-file`, `read-file`, `write-file`, `axle-help` — or `defaults.tools` from
    `cli.yaml` when set. A recipe's `tools:` replaces the set wholesale;
    `tools: []` is the opt-out. Nothing gates a tool call once the folder
    is trusted (invariant 12): shell and writes execute as soon as the
    model asks, in chat, `-j`, batch, and scheduled occurrences alike, so
    content the model reads (attached files, MCP results, web search) can
    drive them. Resume replays the tools stored in the session's
    definition, not the current defaults.

12. **Folder trust gates what the working directory can make the CLI do.**
    Two threats come from cwd: config injection (a repo's `.axle/` points
    a profile at a foreign `baseUrl` or turns tools on) and prompt
    injection (content the model reads steers a model that can act). One
    trust bit, recorded per canonical folder path in `~/.axle/trust.json`
    by `axle trust` (`--revoke` removes it; exact match, no inheritance),
    closes both. Trust is a property of the folder; needing trust is a
    property of the tool: `exec`, `patch-file`, and `write-file` need it,
    `read-file` and `axle-help` do not. In an untrusted folder the
    project `.axle/` layer (`cli.yaml`, `credentials`) is not read, and
    trust-needing tools are dropped from the resolved set whichever layer
    named them — built-in default, `defaults.tools`, or the recipe. Each
    consequence prints one notice naming what was skipped and `axle
trust`. User scope is trusted by definition: nothing under `~/.axle/`
    is gated, and a `-j` recipe stays trusted on invocation because naming
    a file is running a script. MCP servers are outside folder trust;
    their tools act on services, not the folder. The entrypoint looks the
    folder up once and threads the boolean; every input sourced from cwd
    consults it before use (today: the two config loaders and the tool
    resolver; skills will join), and an input that does not is a defect.

## Decisions

- **2026-10-01 — the CLI is open: default tools include shell and writes,
  with no approval step (AXL-32).** The CLI is a power tool; the user owns
  what a run does. Recipes without `tools:` inherit the defaults, so an
  existing tool-less recipe gained `exec`/`write-file` silently — disclosed
  as a breaking change, not designed around. Rejected: a read-only default
  set (`read-file` only) — a chat without shell is not useful enough to be
  the default. Rejected: defaults for chat only — recipes and chat should
  resolve tools the same way. Rejected: dedicated `glob`/`grep` tools —
  `exec` covers search while nothing is gated. Deferred: a classifier or
  approval layer intercepting tool calls before `execute`; when it lands it
  revisits this decision, and read-only search tools become worth adding
  because they can be auto-approved while `exec` is checked. `calculator`
  was deleted the same day as a test-only tool.
- **2026-09-18 — clock-time schedules are a second field, not a richer
  `every`.** `at: HH:MM | [HH:MM]` with optional `on: [weekday]`. Rejected:
  a string grammar (`"mon-fri 09:00"`) — a second parser for what YAML
  already structures. Rejected: cron syntax — expressive but opaque to the
  people who write recipes, and launchd cannot represent all of it.
  Rejected: a `timezone` field — launchd runs in local time; recording a
  zone the registrar ignores would misstate when the job runs. Deferred:
  day-of-month and month, as further fields in the same shape.
- **2026-09-17 — registration moves off the kernel onto the verb (AXL-28,
  reverses 2026-09-13 below before it shipped).** Rejected: plain `-j`
  reconciling as a side effect — running a recipe silently mutated the OS
  scheduler, `--once` existed only to undo that, `axle -j` and
  `axle schedule -j` differed solely in whether the task ran, and deleting
  the block left a live registration nothing reconciled. Rejected: a y/n
  gate on `-j` for scheduled recipes — bare `-j` never prompts, and
  iterating on a recipe would answer it every run; a state line carries the
  same information. Rejected: register-only as the verb's default — a `1d`
  schedule would first fire a day later, unproven, and a `schedule -j` that
  does not run breaks what `-j` means everywhere else. Rejected:
  `--no-run` — a flag deciding whether the kernel boots at all is a verb's
  job; `register` is a management machine like `setup`, and it pairs with
  `remove`. Rejected: launchd `RunAtLoad` for the first run — it fires on
  every login, not once at registration. `--once` is gone: plain `-j` is
  the run-once form. Rejected the same day: a user-facing schedule id with
  prefix lookup, mirrored from sessions — a session has no name but its
  id, a schedule is a recipe, and the id leaked the record filename into
  the interface. Subcommands address schedules by recipe only.
- **2026-09-13 — recurrence lives in the recipe; `-j` reconciles (AXL-28).**
  Rejected: an `axle schedule add <recipe> --every 1h` that stores the
  interval only in `~/.axle` — hidden state that invariant 1 forbids (a
  recurring job's memory is its checked-in YAML). Rejected: reconciling
  only when the record is absent — the behavior would depend on history the
  user cannot see; reconciliation is idempotent instead. Settled: the
  block is the declaration; a recipe without one is refused, not prompted
  for (a TTY wizard that wrote the block into the recipe shipped briefly
  and was removed 2026-09-18 as unearned surface — recoverable from
  history if a need appears). (The apply-and-run gesture moved from `-j`
  to `axle schedule -j` on 2026-09-17, above.)
- **2026-09-13 — sessions are captured without changing the runners.** The
  occurrence learns its session ids from the `SessionStore` it owns (single
  run) or from the batch ledger entries written during the run (batch);
  `runAgentSession`/`runBatch` keep their boolean result. Rejected: widening
  the runner return type — the ticket held the runners fixed, and the
  values already reach the host through owned channels. Rejected: tagging
  session files with a schedule id — a persistence-format change for one
  reader.
- **2026-09-13 — `launchd` apply always boots out first.** launchctl refuses
  to bootstrap a loaded label and reports "No such process" on an unloaded
  one; tolerating the latter lets create, update, and crash recovery share
  one path. Rejected: `RunAtLoad`/`KeepAlive` (an immediate run belongs to
  the foreground `-j`, not the registrar) and a shell wrapper (PATH and
  quoting hazards; the argv is recorded exactly).
- **2026-09-13 — overlap policy is not a recipe field.** `StartInterval`'s
  skip semantics are the only policy; exposing `overlap: skip` would be a
  one-value enum. Deferred with calendar schedules, catch-up, retries,
  Linux/Windows backends, and model-created schedules.

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
- **2026-10-07 — a bare `exit` or `quit` quits the chat.** A message that
  is exactly `exit` or `quit`, in any case, ends the session like `/quit`
  and is never sent to the model. They are magic words, not more slash
  commands.
- **2026-10-08 — the context window is looked up, not assumed (AXL-73).**
  Every model was assumed to have 200,000 tokens unless
  `AXLE_CONTEXT_WINDOW` said otherwise, so 1M-context models compacted at
  160,000 and a per-run environment variable was the only override. The
  window now comes from the provider's `contextWindow`, else core's
  `ModelCatalog`, else 200,000. Rejected: a recipe-level `contextWindow`
  (the window is a property of the endpoint and model, not the task); a
  per-model map in `cli.yaml` (nothing needs it until a hosted model is
  missing from the catalog — then its profile can carry the value); a
  configurable fallback (it would apply only when the lookup misses, which
  the user cannot predict); keeping the environment variable alongside
  (two overrides for one value).
- **2026-10-07 — sessions name configuration instead of copying it.**
  Until now `resolveTarget` spread a provider profile's fields into the
  saved definition and filled an absent `tools:` from `defaults.tools`
  before saving, so editing `cli.yaml` never reached an existing session
  (and an inline `apiKey` landed in the session file in the clear). The
  session now stores the recipe as written — names and gaps included — and
  resolves them on every run. Rejected: referencing the recipe by path
  (a moved or deleted recipe would make the session unresumable, and edits
  could invalidate a live history, e.g. a tool removed mid-conversation);
  stripping keys from the saved config but keeping the rest (a run that
  worked would resume to a "not configured" error with no visible cause);
  re-resolving the model from `defaults.models` on resume (the history is
  the model's, sometimes provider-shaped; switching silently is worse than
  keeping). Inline provider objects stay allowed in recipes — they are the
  portable form, a profile name the shared-machine form — but lose
  `apiKey`, since a recipe is check-in-able.
- **Deferred — subagent fan-out.** Isolation-with-orchestration inside a
  recipe (core's `createAgentTool` + `parallelize`) is a different layer:
  task-level, orchestrator in the loop. It does not compete with batch's
  invocation-level mechanical map and is tracked separately.
