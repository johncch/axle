# Folder trust (AXL-74)

Working note for the change that makes the working directory earn its
influence over a run. It is precursor work for custom tools and skills:
both would let a folder ship executable behaviour, and the question of
what to trust had to be answered before either could be designed.

## Starting point

The CLI picked up three inputs from cwd without asking: `.env`,
`.axle/cli.yaml`, and `.axle/credentials`. Since 2026-10-01 (AXL-32) the
default tool set includes `exec`, `patch-file`, and `write-file`, and
nothing gates a tool call. Cloning a repository and running `axle` in it
therefore handed the repository two levers:

- **Config injection.** A checked-in `.axle/cli.yaml` can point a profile
  at a foreign `baseUrl` (and so receive the prompt and any attached
  files), name an `apiKeyEnv` of its choosing, or set `defaults.tools`.
- **Prompt injection.** Anything the model reads in the folder — a README,
  a fixture, an MCP result — can steer a model that has a shell.

An IDE's "trust this folder?" dialog exists for the first lever (tasks and
extensions that run on open). The CLI had the second lever too, which is
what made a plain prompt worth building: the answer has to change what
the run can do, or it is one more blind click-through.

## The design

**Trust is a property of the folder; needing trust is a property of the
tool.** One switch per folder, recorded by `axle trust`. Each built-in tool
declares whether it acts on the folder: `exec`, `patch-file`, and
`write-file` do; `read-file` and `axle-help` do not. That single flag
answers the recipe question uniformly — a recipe listing `[read-file]`
runs anywhere, a recipe listing `exec` is gated like the default set — and
gives custom tools and skills a slot to fill later.

**Two gates, one bit.** In an untrusted folder the project `.axle/` layer
is not read (closes config injection) and trust-needing tools are dropped
from the resolved set whichever layer named them (closes the shell half of
prompt injection). Each consequence prints one warning naming what was
skipped and the verb to run, and the run continues.

**Ask only when the answer matters.** The prompt fires on a terminal when
the folder is untrusted and either an input file exists in `.axle/` or the
requested tool set contains a trust-needing tool. A read-only recipe in a
bare folder never asks. `y` writes the record and reloads configuration in
the same run; `N` is not recorded, so the question returns. Headless runs
take the `N` path silently. The question precedes the setup wizard, the
model picker, and any schedule registration, so nothing reads the project
layer or registers on the folder's behalf before the user has answered.

**What is outside the gate.** `~/.axle/` is trusted by definition. A `-j`
recipe is trusted on invocation: naming a file is running a script, and
the recipe's `tools:` goes through the same per-tool gate anyway. MCP
servers act on services, not the folder, so they are unaffected.

**Decision in one place, enforcement at each consumption site.** The
entrypoint looks the folder up once and threads the boolean. The two
config loaders and the tool resolver consult it; the architecture doc
lists the sites as an invariant so that skills, when they land, join the
list rather than invent a second mechanism.

## Rejected

- **A bespoke tool format with its own trust metadata.** Trust attaches to
  the existing tool definitions as a set of names; nothing new to author.
- **Gating only the config layer.** The shell is the larger lever. A prompt
  that only toggled `.axle/` would not change what a run can do in most
  folders.
- **Asking on every run in an untrusted folder.** The ask has a
  consequence or it does not fire; a folder with nothing to gate stays
  silent forever.
- **Remembering `N`.** A recorded refusal needs its own verb to undo and
  makes the untrusted state sticky for a folder the user may trust next
  week. Not recording it costs one keystroke per run.
- **Inheriting trust down the tree.** Trusting `~/code` would trust every
  clone under it. Exact match on the real path.
- **YAML for the record.** The file is program-written state, like
  sessions and schedules; JSON matches that precedent and needs no
  comment affordance.
- **Keeping `.env`.** It was a convenience that overlapped with a host
  project's own `.env`. The credentials chain (environment, project
  `.axle/credentials`, `~/.axle/credentials`) covers the use, and
  dropping it leaves `.axle/` as the only project input, which is what the
  gate guards.

## What changed

- `.env` is no longer read; `dotenv` stays as the credentials parser.
- `~/.axle/trust.json` (`{version: 1, folders: {<realpath>: {trustedAt}}}`)
  and the `axle trust [--revoke]` verb.
- `TOOLS_NEEDING_TRUST` and `partitionByTrust` in the tool registry; the
  agent-definition resolver takes a `FolderTrust` and reports
  `droppedTools`.
- Config loaders take a `ConfigContext` with `trusted` and skip the project
  layer when false; `listProjectInputs` names what was skipped.
- The entrypoint computes trust once, asks when `trustWouldChange`, reloads
  on `y`, and prints the notices. Resume loads its session file in the
  entrypoint so the frozen tool list feeds the same check.
- `axle info` shows the trust state and marks project files "found,
  ignored".
- Architecture doc invariant 12; CHANGELOG, README, and `axle-help` text.

## Verification

Unit tests cover the record (missing file, shape, idempotence, symlink,
no inheritance, revoke, malformed file), the partition, the loaders'
project-layer skip, the info output, and `trustWouldChange`. An e2e test
revokes trust in the fixture folder and checks both notices and the tool
list in the captured request. The prompt was exercised under a
pseudo-terminal: `n` left the record empty and printed the notices, `y`
wrote the folder and a following run asked nothing.
