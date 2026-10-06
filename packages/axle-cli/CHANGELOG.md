# Changelog

## Unreleased

### Breaking changes

- **Local tools are on by default.** Chat, and any recipe without a
  `tools:` key, now get `exec`, `patch-file`, `read-file`, and
  `write-file`. They run without approval, including in batch and
  scheduled runs, so a recipe that previously could only return text can
  now run shell commands and write files. Add `tools: []` to keep a recipe
  tool-free, or set `defaults.tools` in `cli.yaml` to change the default
  set everywhere. Resumed sessions keep the tools they were saved with.
- **The `calculator` tool is removed.** A recipe that lists it fails with
  `Unknown tool: calculator`; delete the entry.
- **Every model is assumed to have a 200,000-token context window.** The
  usage bar and the compaction threshold (~80%) no longer look the model up
  in a built-in registry. Set `AXLE_CONTEXT_WINDOW=<tokens>` for a model
  with a different window; a 1M-context model otherwise compacts at about
  160,000 tokens, and a model under 200,000 can overflow before it compacts.
- **`request.temperature`, `request.topP`, and `request.stop` are removed.**
  A recipe that sets one now fails to load. Move it under
  `request.providerOptions` using the provider's own field name
  (`temperature`; `top_p`, or `topP` on Gemini; `stop_sequences`,
  `stopSequences`, or `stop`).
- **The model picker is a text prompt.** `axle setup`, and a run that can't
  resolve a model, ask for a model id as free text instead of listing
  models.

### New

- **`axle info` prints the resolved configuration.** It lists the version,
  runtime, which `cli.yaml` and `credentials` files exist, the default
  provider and tools, every configured provider with its model, and the
  `AXLE_*` environment variables. Each value is followed by where it came
  from: `~/.axle/cli.yaml`, `./.axle/cli.yaml`, a `credentials` file,
  `.env`, or the environment. An API key shows as set or unset, never its
  value.
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
