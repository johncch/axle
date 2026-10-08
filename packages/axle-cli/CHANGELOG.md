# Changelog

## Unreleased

### Breaking changes

- **The working directory's `.env` is no longer read.** Credentials come
  from the process environment, then `.axle/credentials`, then
  `~/.axle/credentials`. Move keys from `.env` into one of those files, or
  pass them for a single run (`ANTHROPIC_API_KEY=... axle`). A host
  project's own `.env` no longer overrides the user's credentials.
- **A recipe's inline `provider:` no longer accepts `apiKey`.** A job file
  is meant to be checked in, so it holds no secrets; one with `apiKey:`
  fails to load with `provider: Unrecognized key: "apiKey"`. Move the key
  to the environment (`ANTHROPIC_API_KEY=... axle -j job.yml`),
  `~/.axle/credentials`, or a `cli.yaml` profile, or point at it with
  `apiKeyEnv`. A run with no key now stops with the variable to set.
- **Resumed sessions follow the current `cli.yaml`.** A session saves a
  provider by name and no longer copies the profile's `baseUrl`, key
  reference, or client options into the session file; `axle resume`
  resolves the profile again, so editing it reaches existing sessions. A
  session whose recipe named no `tools:` likewise takes the current
  `defaults.tools` on resume. Sessions saved before this release still
  carry their copied endpoint and resume as before. An inline provider
  object in a recipe is still frozen with the session.
- **Local tools are on by default.** Chat, and any recipe without a
  `tools:` key, now get `exec`, `patch-file`, `read-file`, and
  `write-file`. They run without approval, including in batch and
  scheduled runs, so a recipe that previously could only return text can
  now run shell commands and write files. Add `tools: []` to keep a recipe
  tool-free, or set `defaults.tools` in `cli.yaml` to change the default
  set everywhere.
- **The `calculator` tool is removed.** A recipe that lists it fails with
  `Unknown tool: calculator`; delete the entry.
- **The context window is looked up in models.dev; `AXLE_CONTEXT_WINDOW`
  is removed.** The usage bar and the compaction threshold (~80%) use the
  model's real window — through the provider's own ids for first-party
  providers, OpenRouter and Together, with a best-effort match for local
  runtimes' names — and assume 200,000 only for a model the catalog lacks.
  The catalog is cached at `~/.axle/cache/models.json` and refreshed in the
  background once a day; a run never waits on the network. Replace
  `AXLE_CONTEXT_WINDOW=<tokens>` with `contextWindow: <tokens>` on the
  provider, in a `cli.yaml` profile or a recipe's inline `provider:` block.
  `axle info` shows each provider's window and its source in place of the
  Environment section.
- **`request.temperature`, `request.topP`, and `request.stop` are removed.**
  A recipe that sets one now fails to load. Move it under
  `request.providerOptions` using the provider's own field name
  (`temperature`; `top_p`, or `topP` on Gemini; `stop_sequences`,
  `stopSequences`, or `stop`).
- **`cli.yaml` rejects keys it does not know.** A misspelled or stale key
  at the top level or under `defaults` (for example `default:` instead of
  `defaults:`) used to be ignored; it now stops the CLI with the key named.
  Remove or correct it.
- **`mcps:` entries reject keys they do not know.** A misspelled key in an
  MCP server entry (for example `arg:` instead of `args:`) used to be
  ignored; the recipe now fails to load with the key named.
- **OpenAI-compatible endpoints time out after 10 minutes.** A
  `chatcompletions` request that has not started responding within 10
  minutes is abandoned and retried, where it used to wait forever. Set
  `timeoutMs` on the provider to change it. A timeout that runs out of
  retries now reports `Request timed out after 600000ms` instead of
  `Request aborted`.
- **The model picker is a text prompt.** `axle setup`, and a run that can't
  resolve a model, ask for a model id as free text instead of listing
  models.

### New

- **Typing `exit` or `quit` quits the chat.** A message that is just
  `exit` or `quit`, in any case, ends the session the same way `/quit` does
  instead of being sent to the model.
- **`axle info` prints the resolved configuration.** It lists the version,
  runtime, which `cli.yaml` and `credentials` files exist, the default
  provider and tools, every configured provider with its model, and
  `AXLE_CONTEXT_WINDOW`. Each value is followed by where it came
  from: `~/.axle/cli.yaml`, `./.axle/cli.yaml`, a `credentials` file,
  `.env`, or the environment. An API key shows as set or unset, never its
  value.
- **`axle explain` describes the configuration keys.** `axle explain` lists
  the top-level keys of a recipe and of `cli.yaml`, each with its type, what
  it does, and the keys beneath it. A dotted path such as
  `axle explain recipe.request.reasoning` or `axle explain config.defaults`
  goes one level down. Lists and maps are skipped in a path
  (`recipe.mcps.command`). Output wraps to the terminal, up to 100 columns.
  The same descriptions appear as hover text in editors that use the job
  schema.
- **Editor schemas for recipes and `cli.yaml`.** The schemas at
  `schemas/v3/job.yaml` and the new `schemas/v3/config.yaml` carry a
  description for every key. Point the YAML language server at them by URL
  (see Configuration in the README) for completion and hover text.
- **The model sees the full key reference.** The `axle-help` tool's
  `recipes` and `config` topics now end with every key, its type, and its
  description, generated from the same schemas as `axle explain`.
- **Replies render as markdown.** Under the ink renderer, a reply shows
  headings in bold, inline `code` in yellow, fenced code behind a `│`
  gutter, lists with plain markers, and tables as aligned columns instead
  of raw `#`, `**`, pipes, and backticks. The reasoning summary on a
  `✔ Thinking` line renders the same way, and so does text while it is
  still streaming. `--renderer plain` and piped output are unchanged.
- **The model can explain axle.** A new default tool, `axle-help`, returns
  this CLI's usage documentation by topic (overview, chat, recipes, batch,
  resume, schedule, mcp, config, tools), so asking the chat how to write a
  batch recipe or register a schedule gets an answer grounded in the
  installed version. Remove it with a `tools:` list that omits it.
- **Prompts look like the GitHub CLI.** `axle setup`, `axle cleanup`, and
  the missing-model fallback ask with a green `?`, echo the answer in cyan
  on the same line, and use a `>` cursor for lists. A confirm answers to
  `y` or `n` without Enter. The vertical guide bar and diamond markers are
  gone.
- **A provider's code execution shows what it printed.** When a recipe
  lists `code_execution` under `providerTools`, the action line now carries
  the first line of the sandbox's stdout, or its stderr and exit code in
  red when the script exited non-zero, the way an `exec` call does. Works
  on OpenAI, Anthropic and Gemini; Anthropic's code execution is newly
  available and reports its steps as `bash_code_execution` and
  `text_editor_code_execution` actions.
- **Recipes can run on a schedule (macOS).** Add a `schedule: { every: 1h }`
  block and run `axle schedule -j <recipe>`: it registers a user
  LaunchAgent and runs the recipe once now; each later firing re-reads the
  recipe and runs it like `-j`, saving a session. `schedule register -j` registers without running, `schedule list` shows registrations and their last run,
  `schedule sessions -j` lists each run's `axle resume` command, and
  `schedule remove -j` unregisters; schedules are addressed by recipe, never
  by an id. Plain `axle -j` never touches the schedule; it prints whether
  the recipe is registered or has drifted. Intervals are
  `<integer><s|m|h|d>`, 60s minimum. Fixed times of day use
  `schedule: { at: "09:00" }`, or a list of times, with optional
  `on: [mon, fri]`; times are machine-local. Linux and Windows are not
  supported yet.
- **Thinking text now streams from Claude and OpenAI models.** `request.reasoning`
  with `on` or `{ effort }` asks every provider that has a disclosure field
  for its thinking; previously Anthropic and OpenAI requests inherited a
  hidden default and rendered no thinking at all. Add `display: hidden`
  under `{ effort }` to keep thinking off the wire.
- **Claude through OpenRouter shows its thinking summary and keeps its
  reasoning across tool calls.** OpenRouter's `reasoning_details` are now
  read and echoed back, so summaries render as summaries and multi-turn tool
  loops on a Claude model keep their signatures. `display: hidden` keeps
  thinking out of the transcript on every provider, OpenRouter included.
- **A refused request says so.** When a provider declines a request or
  blocks its output, the run fails with `Refused`, the provider's reason,
  and its explanation in full, in the form `Refused (cyber): <explanation>`.
  Before, a refusal from Claude or an OpenAI model printed an empty answer
  and counted as a success, and a Gemini safety block read as a generic
  model error.

## 0.31.0

### Breaking changes

- **`-j` is no longer required; modes are verbs, not flags.** Bare `axle`
  starts an interactive chat; `-j recipe.yml` runs a recipe (`-i` continues
  interactively after the task); `-m` sends a one-shot message. `batch`,
  `resume`, `setup`, and `cleanup` are subcommands.
- **Job YAML is renamed and strict** (schema v3 — unknown or pre-0.31 keys
  fail loudly instead of being silently stripped):

  | Before           | After                                              |
  | ---------------- | -------------------------------------------------- |
  | `provider.model` | top-level `model` (publisher-qualified id or bare) |
  | `api-key`        | `apiKey`                                           |
  | `api-key-env`    | `apiKeyEnv`                                        |
  | `base-url`       | `baseUrl`                                          |
  | `provider_tools` | `providerTools`                                    |

  `schemas/v2/job.yaml` is frozen as the pre-0.31 reference;
  `schemas/v3/job.yaml` is generated from the Zod schema
  (`pnpm run generate:job-schema`).

- **`batch.resume` is removed.** Skipping completed inputs is opt-in:
  `--incremental` (or `incremental: true` in the `batch:` block) skips
  completed inputs whose content is unchanged; a plain run re-runs
  everything. The batch block is `{files, concurrency, incremental}`.
- **Credentials and config move to layered homes.** Per key: process env
  (including `.env`) → project `.axle/credentials` → user
  `~/.axle/credentials` (dotenv format, same key names as the env vars).
  An env var set to the empty string now counts as unset and falls through
  (previously `""` disabled the provider). `cli.yaml` (user and project,
  project wins) holds `providers:` endpoint profiles and `defaults:`
  (`provider`, `models`). A chatcompletions endpoint activates on
  `CHATCOMPLETIONS_BASE_URL` alone.
- **Removed exports.** The `./store` subpath export and `LocalFileStore`
  are gone. `ExecProviderConfig` and `execTool.configure()` are removed
  from `./tools`; exec options are constructor-only via the now-exported
  `ExecTool` class.
- **Logs actually write** to `~/.axle/logs/cli/<timestamp>.log`
  (`--no-log` disables).

### New

- **Every run is a session.** Chat, one-shot, recipe runs, and each batch
  item persist to `~/.axle/sessions/cli/<id>.json`; `axle resume <id>`
  (unique prefixes accepted) re-enters any of them. `axle cleanup` deletes
  sessions by age window.
- **First-run setup wizard** (`axle setup`): pick a provider, store a key,
  pick a default model. Runs that can't resolve a model drop into the same
  picker.
- **Automatic compaction.** Long sessions compact at ~80% of the model's
  context window into a ~1000-word summary plus recent user messages kept
  verbatim. Opt out per recipe with `compaction: false`;
  `AXLE_CONTEXT_WINDOW` overrides the resolved window.
- **Provider resolution chain.** `provider` and `model` are both optional
  in a recipe; anything omitted resolves through `cli.yaml` defaults, then
  `*_MODEL` credentials, then the interactive picker.
- **New terminal UI.** Task-runner-style ink renderer (spinners settling
  to work lines with durations, context usage bar, multiline input,
  graceful two-stage Ctrl-C); batch runs show per-item progress rows;
  piped output falls back to a line-oriented renderer.
- Recipes gain top-level `system` and a `request:` block (`reasoning`,
  `maxOutputTokens`, `temperature`, `topP`, `stop`, `toolChoice`,
  `parallelToolCalls`, `providerOptions`). `reasoning` takes `default`,
  `off`, `on`, or `{ effort: low | medium | high }`.

Built on Axle 0.31.0 — see
[docs/0.31.0-migration.md](../../docs/0.31.0-migration.md) for the library's
breaking changes.
