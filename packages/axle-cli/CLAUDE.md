# axle-cli

`docs/architecture/cli.md` (repo root) is normative for this package's
invocation grammar and session model — read it before changing the CLI
surface, runners, or session handling. Divergence between that doc and this
code is a defect: fix the code or update the doc in the same change.

The principles that bind all work here:

- **A recipe is a saved partial application of an invocation.** The job
  YAML can pre-commit anything the command line could say; the command line
  overrides selectively. Resolution is one gradient: env/credentials <
  cli.yaml defaults < recipe < command line. Never move a recurring job's
  memory out of the checked-in YAML.
- **Verbs select the machine; flags parameterize it.** `batch`, `resume`,
  `setup`, `cleanup` are machines composed on the session kernel (bare
  `axle`, `-j`, `-m`). Never add a mode as a flag; never add a verb whose
  behavior could be a parameter.
- **Every run is a session** — including each batch item. Anything that ran
  can be re-entered with `axle resume <id>`.
- **Batch = isolation as the feature** (independence, uniformity,
  completeness), mechanically mapped with no orchestrator model — and
  deliberately removable: a verb + a block key + a ledger, nothing more.
- **Interactive is for steering, not a coding agent** (axle-code exists).
  `/quit` is the only slash command.
- **UI is a task runner, not a chat app** — consola/tsdown glyph gutter;
  model text is stdout; the only persona glyph is the user's `❯`. See the
  decision log on Linear AXL-20/21.
