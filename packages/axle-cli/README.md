# Axle CLI

An AI task runner built on [Axle](https://www.npmjs.com/package/@fifthrevision/axle).
Chat from the terminal, save recurring jobs as checked-in YAML recipes, fan a
recipe out over a folder of inputs — and resume any run, because every run is
a session.

A recipe is a saved partial application of an invocation: anything the
command line could say has a home in the YAML, and the command line
overrides selectively. The normative design lives in
[docs/architecture/cli.md](../../docs/architecture/cli.md).

## Installation

```bash
npm install -g @fifthrevision/axle-cli
```

## Usage

Bare `axle` starts an interactive chat using the default provider and model
from `~/.axle/cli.yaml` (`defaults.provider`, `defaults.models`). Running a
YAML job file with `-j` is the non-interactive path.

On first run with no configuration anywhere — no credentials, no `cli.yaml`
providers or defaults, no inline provider in the recipe — `axle` launches a
setup wizard:
pick a provider, paste a key (written to `~/.axle/credentials`, chmod 600),
and enter a default model id. Re-run it anytime with `axle setup`. A run that
can't resolve a model drops into the same model prompt.

Sessions accumulate under `~/.axle/sessions/cli/` with no automatic
retention; `axle cleanup` deletes them by age window (24h/7d/30d/all).

```bash
axle                                 # interactive chat from configured defaults
axle -m "one question"               # one-shot message, prints and exits
axle -j path/to/job.yaml             # run a job file and exit
axle -j path/to/job.yaml -i          # run the task, then continue interactively
axle -j path/to/job.yaml --args key=value other=thing
axle batch -j recipe.yaml 'data/*.md'   # fan a recipe out over inputs
axle resume <id>                     # re-enter any saved session
axle resume <id> -m "follow up"      # one-shot continuation
axle schedule add -j recipe.yaml     # register a recurring recipe (macOS); nothing runs
axle schedule list                   # registered schedules and their last run
axle schedule sessions -n <name>     # sessions a schedule's firings produced
axle schedule remove -n <name>       # unregister; recipe, sessions, and logs stay
axle setup                           # (re)configure providers and defaults
axle info                            # print version, config files, and resolved config
axle explain recipe.batch            # describe the keys a recipe or cli.yaml accepts
axle trust                           # trust the current folder's .axle/ and tools that act; --revoke undoes it
axle cleanup                         # delete old sessions by age window
```

Verbs select the machine; flags parameterize it. A session id prefix works
anywhere a full id does (`axle resume 3a2f` finds the unique match).

In the chat, `/quit`, a message that is just `exit` or `quit` (any case), or
Ctrl-C / Ctrl-D at the prompt exits. Ctrl-C during a turn asks the agent to
stop at the next tool boundary; a second Ctrl-C cancels immediately. The
session is saved on every exit path.

`--renderer` picks the screen renderer for the run: `ink` (default — terminal
UI with a live streaming region and input line) or `plain` (line-oriented).
Piped input or output always gets plain. `--no-log` disables the run log
(otherwise written to `~/.axle/logs/cli/<timestamp>.log`), `-d`/`--debug`
prints debug detail, and `--args key=value` supplies `{{variables}}` to the
recipe's task template.

Every run persists a resumable session to `~/.axle/sessions/cli/<id>.json`
(the id is printed at run start and exit). Resuming restores the saved
conversation, model, and recipe — no job file needed — and resolves a
provider name or the default tools against the current `cli.yaml`, so a
profile edit reaches existing sessions.

A job file specifies the provider, task prompt, and optional tools/files:

```yaml
# job.yaml
provider: anthropic
model: anthropic/claude-sonnet-5

task: |
  Summarize the attached document.

tools:
  - read-file

providerTools:
  - web_search

files:
  - ./data/report.txt
```

The sections below cover the common keys. `axle explain recipe` lists every
key a recipe accepts, with its type and what it does, and
`axle explain recipe.<key>` goes one level down (for example
`axle explain recipe.request`).

`provider` says where requests go. A string names a provider — a built-in
type (`anthropic`, `openai`, `gemini`, `chatcompletions`) or a provider
profile from `cli.yaml` — and an object is inline endpoint configuration.
Both `provider` and `model` are optional; anything the job leaves out
resolves through the config chain:

- provider: job → `defaults.provider` in `cli.yaml`
- model: job → `defaults.models.<provider name>` → `<TYPE>_MODEL` env or
  credentials → interactive model prompt

So a model-only job runs on the configured default provider, and a job with
neither runs entirely on defaults. `model` is a publisher-qualified id (e.g.
`anthropic/claude-sonnet-5`, `openai/gpt-5.5`) or a bare provider-native id:

```yaml
# Ollama, or any OpenAI-compatible endpoint
provider:
  type: chatcompletions
  baseUrl: http://localhost:11434/v1
model: gemma3
```

Optional `system` sets the system prompt, and an optional `request` block
sets provider-portable request options:

```yaml
system: You are a terse analyst.

request:
  reasoning: on
  maxOutputTokens: 16000
```

Anything the portable options don't cover goes in `providerOptions`, which is
sent to the provider as-is under its own field names:

```yaml
request:
  providerOptions:
    temperature: 0.2
```

`reasoning` takes `default`, `off`, `on`, or
`{ effort: low | medium | high, display?: visible | hidden }`. `display`
defaults to `visible`; `hidden` asks the provider to keep its thinking off
the wire.
Leave it unset (or `default`) and the model runs at its provider's own
default, which is always safe, including for models that cannot disable
thinking. `on` is medium effort; `off` sends the provider's explicit disable
and is rejected by models that cannot turn thinking off. On models that only
take a thinking budget (Claude Haiku, Opus, and Sonnet 4.5; Gemini 2.5), a
`maxOutputTokens` you set must exceed the budget: 8,192 for `on`, 16,384 for
`high`. Leave it unset and Axle's default already does.

```yaml
request:
  reasoning:
    effort: high
```

Long sessions compact automatically: when the conversation approaches the
context window (~80% of the model's window), the next send first replaces the history with
a ~1000-word summary plus a slice of recent user messages kept verbatim (up
to a tenth of the threshold), summarized by the session's own provider, model, and
`reasoning` setting; the transcript records a `✔ Compacted context` line.
Compacted sessions snapshot and resume like any other. Opt out per recipe
with:

```yaml
compaction: false
```

The window is looked up in the [models.dev](https://models.dev) catalog by
the model id — through the provider's own ids for first-party providers,
OpenRouter and Together, with a best-effort match for local runtimes' names
(`gemma4:26b-mlx`) — and falls back to 200,000 for a model the catalog
lacks. The catalog is cached at `~/.axle/cache/models.json` and refreshed in
the background once a day; a run never waits on the network. `axle info`
shows each provider's window and where it came from, including the matched
catalog id. A provider's `contextWindow` overrides the lookup for every
model on that endpoint — set it for a local server that loads models below
their maximum:

```yaml
providers:
  ollama:
    type: chatcompletions
    baseUrl: http://localhost:11434/v1
    contextWindow: 32768
```

The same key on a recipe's inline `provider:` block works too. A small value
(e.g. `3000`) forces a compaction within a few exchanges, which is also the
way to see one without filling a real context window.

Chat and job files get these local tools by default:

- `axle-help` — this README, by topic, so the model can answer questions
  about axle itself
- `exec`
- `patch-file`
- `read-file`
- `write-file`

They run without asking for approval — including `exec` and `write-file`,
and including in scheduled and batch runs — once the folder is trusted
(see [Folder trust](#folder-trust)); in an untrusted folder `exec`,
`patch-file`, and `write-file` are dropped. A job's `tools:` list replaces
the defaults; `tools: []` runs with no local tools. `defaults.tools` in
`cli.yaml` replaces the built-in default set for both chat and jobs.

## Batch

Batch is map(recipe, inputs): one isolated session per input. Inputs resolve
as positional arguments to the `batch` verb, then the recipe's `batch:`
block, then an interactive prompt:

```bash
axle batch -j summarize.yml 'data/*.txt'   # inputs from the command line
axle batch -j summarize.yml                # inputs from the recipe, or prompted
axle -j summarize.yml                      # batch: block present → batch run
```

For a recurring job, put the inputs in the recipe — it stays
self-documenting and runs with plain `-j`:

```yaml
# job.yaml
provider: anthropic

task: |
  Summarize this file ({{file}}).

batch:
  files: "./data/*.txt"
  concurrency: 3
```

Each matched file is attached to the instruct and available as `{{file}}`.
Every input runs as its own session, so a failed item is inspected or
continued like any other run: `axle resume <id>` (every settled item line
prints the id). A project-local ledger (`.axle/batch.jsonl`) indexes
input → session. Skipping is opt-in: `--incremental` (or
`incremental: true` in the block; `--no-incremental` overrides) skips
completed inputs whose content is unchanged — useful when a folder of
inputs grows over time. Recipe edits never auto-invalidate; a plain run is
the force-fresh gesture and re-runs everything.

On a terminal, batch shows test-runner-style progress: one spinner row per
in-flight item (current phase, elapsed) and a running totals line, with
settled items committed to scrollback. `--verbose` (or `concurrency: 1`)
streams each item's full transcript instead. Piped output prints one line
per settled item.

Batch runs are non-interactive; a batch job cannot be combined with
`--interactive`.

## Schedules

A recipe can declare its own recurrence. On macOS, `axle schedule add -j`
registers it as a user LaunchAgent; every firing re-reads the recipe and
runs it exactly as `-j` would. Registering runs nothing, so prove the
recipe first with a plain `axle -j`.

```yaml
# monitor.yaml
name: hourly-monitor
provider: anthropic

schedule:
  every: 1h

task: |
  Check the API. Send an email only if the condition is met.
```

`every` is a fixed elapsed interval: `<integer><unit>` with unit `s`, `m`,
`h`, or `d` (a day is 24 hours); `60s` is the minimum. For a fixed time of
day use `at` instead, optionally limited to weekdays with `on`:

```yaml
schedule:
  at: "09:00" # every day at 09:00, machine-local time

schedule:
  at: ["09:00", "17:30"] # more than one time a day
  on: [mon, tue, wed, thu, fri]
```

Times are `HH:MM` in 24-hour form, in the machine's local time; there is no
timezone setting. A recipe declares either `every` or `at`, not both. Cron
expressions and day-of-month schedules are not supported yet.

```bash
axle schedule add -j monitor.yaml        # register or update; prints the next firing
axle schedule list
axle schedule sessions -n hourly-monitor # or -j monitor.yaml
axle schedule remove -n hourly-monitor   # or -j monitor.yaml
axle -j monitor.yaml                     # just run it; the schedule is never touched
```

The first scheduled firing comes one full interval after registering, or
at the next matching clock time, and every apply prints when that is.
Nothing runs at registration: a plain `axle -j` is the run, with the same
tools, credentials, and session a firing gets.

A schedule is addressed by its recipe, and `sessions` and `remove` also
take the name `list` shows, which is the recipe's `name:` or its file
stem; a name two schedules share is refused with both paths. There is no
separate id to learn. Applying is idempotent: the same recipe path is the
same schedule, so repeating it prints "is current" and changes nothing.
An update says what changed (`every 1h → 15m`, `cwd … → …`). Editing the
task, model, tools, or `batch:` block takes effect on the next firing with
no re-registration; changing `every`, or applying from a different
directory, updates the registration. `add` refuses a recipe without a
`schedule` block.

A plain `axle -j` on the recipe only runs it, and prints one line about its
schedule: not registered, scheduled with its last run, or a warning when
the recipe and the registration have drifted apart (the interval changed,
or the block was deleted while the schedule is still registered).

Each firing runs with the working directory the recipe was applied from,
resolves credentials and config exactly like a foreground run (user
`.axle/`, plus the project's when the folder is trusted), and saves a
fresh resumable session
— one per input for a batch recipe. `axle schedule sessions -j` lists
those runs newest first with their `axle resume` command; stdout and
stderr also land in `~/.axle/logs/schedules/<id>.out.log` and `.err.log`.
A schedule never overlaps itself: if a firing is still running when the
next one is due, that firing is skipped rather than queued. Intervals
missed while the machine sleeps are not replayed; a clock time missed
while asleep runs once on wake. A failed
firing exits non-zero into the log and leaves later firings registered.

`remove` unloads the LaunchAgent and deletes only its plist and the
schedule record. Recipes, sessions, logs, and other LaunchAgents are left
alone, and `schedule sessions -j` still lists the runs a removed schedule
produced. A recipe that was moved or deleted can still be removed by the
path `list` shows. `list` flags a schedule whose LaunchAgent is no longer loaded, and
applying again restores it. On Linux and Windows, registering fails and
plain `axle -j` still runs the recipe.

## MCP Servers

Add an `mcps` key to connect to MCP servers. Both stdio and HTTP transports
are supported.

```yaml
# job.yaml
provider:
  type: anthropic

mcps:
  - name: wc
    transport: stdio
    command: npx
    args: ["tsx", "packages/axle/examples/mcps/wordcount-server.ts"]
  - transport: http
    url: http://localhost:3100/mcp

task: |
  Count the words in "hello world"
```

Each entry supports:

- `transport` — `"stdio"` or `"http"` (required)
- `name` — prefix for tool names from this server (optional)
- `command` / `args` / `env` — for stdio transport
- `url` / `headers` — for HTTP transport

`axle explain recipe.mcps` prints the same keys with their types.

## Skills

A skill is a folder in the [Agent Skills](https://agentskills.io) format: a
`SKILL.md` whose frontmatter has `name` and `description` and whose body is
the instructions, plus any `scripts/`, `references/`, or `assets/` beside it.
Skills written for Claude Code or other compliant clients work unchanged.

```
~/.axle/skills/pdf/
├── SKILL.md
├── scripts/merge.py
└── references/forms.md
```

Skills are found in two scopes. Within a scope the first directory wins:

| Scope   | Directories                            | Loaded                     |
| ------- | -------------------------------------- | -------------------------- |
| User    | `~/.axle/skills/`, `~/.agents/skills/` | always                     |
| Project | `./.axle/skills/`, `./.agents/skills/` | once the folder is trusted |

Every run, chat and recipe alike, gets every skill found. Nothing in a
recipe selects among them. The model sees one line per skill in its system
prompt and calls `view-skill` to load the full instructions when a task
matches; the instructions name files relative to the skill folder, which the
model reads with `read-file` and runs with `exec`. A project skill shadows a
user skill of the same name, with a warning naming both. A `SKILL.md` that
fails to parse is skipped with a warning naming the file.

In an untrusted folder the project directories are ignored with the same
notice as the project `cli.yaml` (see [Folder trust](#folder-trust)), and
user skills still load but their scripts cannot run, because `exec` is
dropped. `axle info` lists every skill directory and whether it was loaded,
shadowed, ignored, or invalid. `axle-help` has a `skills` topic.

## Folder trust

A folder can make the CLI do two things on its behalf: its `.axle/` can
reconfigure a run (point a profile at another host, change the default
tools), and content the model reads there can steer a model that has
shell and file access. Both are gated by one per-folder switch. Every
folder starts untrusted; `axle trust` flips it:

```bash
axle trust            # trust the current folder
axle trust --revoke   # stop trusting it
```

In an untrusted folder:

- `exec`, `patch-file`, and `write-file` are dropped from the tool set,
  whether the built-in default, `defaults.tools`, or the recipe's `tools:`
  named them. `read-file` and `axle-help` stay.
- `.axle/cli.yaml`, `.axle/credentials`, and the project skill directories
  are not read. `~/.axle/` is never gated.
- Each consequence prints one warning and the run continues:
  `Dropped exec: this folder is not trusted (run axle trust)`.

On a terminal the CLI asks once, `It looks like this folder is untrusted,
trust it? (y/N)`, but only when the answer would change the run: the
folder has a `.axle/cli.yaml`, `.axle/credentials`, or a project skill, or
the run's tool set includes a trust-needing tool. A read-only recipe in a bare folder
never asks. Answering `y` records the folder and the run proceeds with the
project layer and the full tool set; `N` is not remembered, so the
question returns next time. A headless run (a pipe, cron, a scheduled
firing) never asks and takes the untrusted path. The question comes before
`axle schedule` registers anything.

The record is `~/.axle/trust.json`, keyed by the folder's real path. Trust
is exact: trusting a folder does not trust the folders under it, and a
symlink to a trusted folder counts as trusted. MCP servers are outside
folder trust; their tools act on services, not the folder. `axle info`
shows the folder's trust state and marks project files that were found
but ignored.

## Configuration

`axle explain` prints every key a recipe and `cli.yaml` accept, and
`axle explain <path>` describes one, for example
`axle explain recipe.request.reasoning` or `axle explain config.providers`
(`config` is `cli.yaml`). Each key lists the keys beneath it, which are the
next path segments.

For completion and hover text in an editor that runs the YAML language
server, put the matching line at the top of the file:

```yaml
# a recipe
# yaml-language-server: $schema=https://raw.githubusercontent.com/johncch/axle/main/schemas/v3/job.yaml

# cli.yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/johncch/axle/main/schemas/v3/config.yaml
```

For CLI use, put provider secrets in your environment or a credentials
file. Credentials files use the same key names as the environment
variables, one `KEY=value` per line, and are read in order — environment
first, then the project's `.axle/credentials`, then the user-level
`~/.axle/credentials`. A `.env` in the working directory is not read, so a
host project's own `.env` never leaks into the CLI:

```bash
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
```

Optional model overrides use provider-specific variables:

```bash
OPENAI_MODEL=openai/gpt-5.5
ANTHROPIC_MODEL=anthropic/claude-sonnet-5
GEMINI_MODEL=google/gemini-3.5-flash
```

For OpenAI-compatible endpoints:

```bash
CHATCOMPLETIONS_BASE_URL=http://localhost:11434/v1
CHATCOMPLETIONS_MODEL=llama3
CHATCOMPLETIONS_API_KEY=...
```

A job file never holds a key — it is meant to be checked in — so its inline
provider rejects `apiKey`. To reference a non-standard environment variable
from a job file, use `apiKeyEnv`:

```yaml
provider:
  type: openai
  apiKeyEnv: CUSTOM_OPENAI_KEY
```

A run with no key for its provider stops with the variable to set, e.g.
`ANTHROPIC_API_KEY=... axle -j job.yml`.

`cli.yaml` (user-level `~/.axle/cli.yaml`, overridden per-project by
`.axle/cli.yaml` once the folder is trusted) holds named provider profiles
and defaults:

```yaml
providers:
  openrouter: # a profile: pure endpoint config, no model
    type: chatcompletions
    baseUrl: https://openrouter.ai/api/v1
    apiKeyEnv: OPENROUTER_API_KEY

defaults:
  provider: openrouter # used when a job names no provider
  models: # per-provider default models
    openrouter: z-ai/glm-4.6
    anthropic: anthropic/claude-sonnet-5
  tools: [read-file, exec] # replaces the built-in default tool set
```

Profile names share a namespace with the built-in types and may shadow
them. Across the user and project layers, `defaults` merge per key while
profiles replace wholesale.
