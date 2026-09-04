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

On first run with no credentials anywhere, `axle` launches a setup wizard:
pick a provider, paste a key (written to `~/.axle/credentials`, chmod 600),
and pick a default model. Re-run it anytime with `axle setup`. A run that
can't resolve a model drops into the same model picker.

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
axle setup                           # (re)configure providers and defaults
axle cleanup                         # delete old sessions by age window
```

Verbs select the machine; flags parameterize it. A session id prefix works
anywhere a full id does (`axle resume 3a2f` finds the unique match).

In the chat, `/quit` (or Ctrl-C / Ctrl-D at the prompt) exits. Ctrl-C during
a turn asks the agent to stop at the next tool boundary; a second Ctrl-C
cancels immediately. The session is saved on every exit path.

`--renderer` picks the screen renderer for the run: `ink` (default — terminal
UI with a live streaming region and input line) or `plain` (line-oriented).
Piped input or output always gets plain. `--no-log` disables the run log
(otherwise written to `~/.axle/logs/cli/<timestamp>.log`), `-d`/`--debug`
prints debug detail, and `--args key=value` supplies `{{variables}}` to the
recipe's task template.

Every run persists a resumable session to `~/.axle/sessions/cli/<id>.json`
(the id is printed at run start and exit). Resuming restores the saved
provider, model, tools, and conversation — no job file needed.

A job file specifies the provider, task prompt, and optional tools/files:

```yaml
# job.yaml
provider: anthropic
model: anthropic/claude-sonnet-5

task: |
  Summarize the attached document.

tools:
  - calculator

providerTools:
  - web_search

files:
  - ./data/report.txt
```

`provider` says where requests go. A string names a provider — a built-in
type (`anthropic`, `openai`, `gemini`, `chatcompletions`) or a provider
profile from `cli.yaml` — and an object is inline endpoint configuration.
Both `provider` and `model` are optional; anything the job leaves out
resolves through the config chain:

- provider: job → `defaults.provider` in `cli.yaml`
- model: job → `defaults.models.<provider name>` → `<TYPE>_MODEL` env or
  credentials → interactive model picker

So a model-only job runs on the configured default provider, and a job with
neither runs entirely on defaults. `model` is a publisher-qualified registry
id (e.g. `anthropic/claude-sonnet-5`, `openai/gpt-5.5`) or a bare
provider-native id:

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
  reasoning: true
  temperature: 0.2
  maxOutputTokens: 4096
```

`reasoning` is tri-state by omission: leave it unset and the model runs at
its provider's own default (always safe, including for models that cannot
disable thinking); `true` opts in, `false` opts out where the provider can
express it.

Long sessions compact automatically: when the conversation approaches the
model's context window (~80%), the next send first replaces the history with
a ~1000-word summary plus a slice of recent user messages kept verbatim (up
to a tenth of the threshold), summarized by the session's own provider, model, and
`reasoning` setting; the transcript records a `✔ Compacted context` line.
Compacted sessions snapshot and resume like any other. Opt out per recipe
with:

```yaml
compaction: false
```

`AXLE_CONTEXT_WINDOW=<tokens>` overrides the resolved window when the
registry gets a model wrong — the usage bar, compaction threshold, and
summary target all scale with it. A small value (e.g. `3000`) forces a
compaction within a few exchanges, which is also the way to see one without
filling a real context window.

CLI job files can use these local tool names:

- `calculator`
- `exec`
- `patch-file`
- `read-file`
- `write-file`

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
    args: ["tsx", "examples/mcps/wordcount-server.ts"]
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

## Configuration

For CLI use, put provider secrets in your environment, a local `.env` file, or
a credentials file. Credentials files use the same key names as the
environment variables, one `KEY=value` per line, and are read in order —
environment first, then the project's `.axle/credentials`, then the
user-level `~/.axle/credentials`:

```bash
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
```

Optional model overrides use provider-specific variables:

```bash
OPENAI_MODEL=openai/gpt-5.5
ANTHROPIC_MODEL=anthropic/claude-sonnet-5
GEMINI_MODEL=google/gemini-3.5-pro
```

For OpenAI-compatible endpoints:

```bash
CHATCOMPLETIONS_BASE_URL=http://localhost:11434/v1
CHATCOMPLETIONS_MODEL=llama3
CHATCOMPLETIONS_API_KEY=...
```

Provider-level keys in the job file override environment variables. To
reference a non-standard environment variable from a job file, use `apiKeyEnv`:

```yaml
provider:
  type: openai
  apiKeyEnv: CUSTOM_OPENAI_KEY
```

`cli.yaml` (user-level `~/.axle/cli.yaml`, overridden per-project by
`.axle/cli.yaml`) holds named provider profiles and defaults:

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
```

Profile names share a namespace with the built-in types and may shadow
them. Across the user and project layers, `defaults` merge per key while
profiles replace wholesale.
