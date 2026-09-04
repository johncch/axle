# Changelog

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
  `parallelToolCalls`, `providerOptions`).

Built on Axle 0.31.0 — see
[docs/0.31.0-migration.md](../../docs/0.31.0-migration.md) for the library's
breaking changes.
