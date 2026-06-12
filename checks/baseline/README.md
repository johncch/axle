# Baseline Provider Checks

These checks run real provider calls against Axle's core public workflows. They
are intended as a publish smoke test, not as unit tests or performance
benchmarks.

## Usage

Run the default provider set at their default smoke models:

```bash
pnpm exec tsx checks/baseline/run.ts
```

The default set is OpenAI, Anthropic, Gemini, and Together. OpenRouter is
available as an explicit alternative Chat Completions provider.

Run one provider:

```bash
pnpm exec tsx checks/baseline/run.ts --provider openai
```

Run every provider, including OpenRouter:

```bash
pnpm exec tsx checks/baseline/run.ts --all
```

Override the model for one provider:

```bash
pnpm exec tsx checks/baseline/run.ts --provider openai --model gpt-5.4
```

Enable provider reasoning/thinking controls where supported:

```bash
pnpm exec tsx checks/baseline/run.ts --provider anthropic --model claude-opus-4-8 --thinking
```

Run selected cases:

```bash
pnpm exec tsx checks/baseline/run.ts --case generate-basic,agent-basic
```

Provider API keys are loaded from your shell environment or repo-local `.env`:

```bash
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=...
TOGETHER_API_KEY=...
BRAVE_API_KEY=...
```

`BRAVE_API_KEY` is required for baseline runs. The fallback is configured once
at runner startup so native web-search providers are exercised while a fallback
is present, and fallback providers such as Together use Brave automatically.
The PDF attachment case is excluded because Together's Chat Completions API
does not accept PDF file parts. Override Together's default smoke model with
`TOGETHER_MODEL`.

Run the native OpenRouter search path:

```bash
pnpm exec tsx checks/baseline/run.ts \
  --provider openrouter \
  --case stream-web-search
```

Run the Together + Brave fallback path:

```bash
pnpm exec tsx checks/baseline/run.ts \
  --provider together \
  --case stream-web-search
```

Run specific configuration against a set of models

```
for model in claude-opus-4-8 claude-opus-4-7 claude-sonnet-4-6 claude-opus-4-6
do
  pnpm exec tsx checks/baseline/run.ts \
    --provider anthropic \
    --model "$model" \
    --case generate-basic \
    --thinking \
    --out "output/checks/baseline-anthropic-${model}-thinking.jsonl"
done
```

## Cases

- `generate-basic`
- `stream-basic`
- `generate-instruct-json`
- `stream-instruct-json`
- `generate-instruct-history`
- `agent-basic`
- `agent-instruct-json`
- `agent-multiturn-history`
- `generate-tool`
- `generate-deferred-tool-file`
- `generate-unsupported-tool-file` (Chat Completions binary tool-result fallback)
- `stream-tool`
- `agent-tool`
- `generate-parallelized-tool`
- `agent-subagent-tool` (including child usage attribution)
- `agent-tool-fatal` (fatal tool error terminates the send with usage intact)
- `agent-subagent-abort` (cancel mid-delegation; no child conversation leak)
- `agent-parallel-subagents` (parallelize + createAgentTool fan-out)
- `reasoning-false`
- `stream-web-search`
- `instruct-text-reference`
- `instruct-context`

The runner writes JSONL records to `output/checks/` and exits non-zero if any
case fails or errors. For every case that reports `usage` in its details, the
runner additionally verifies usage conservation: the per-provider/model
`breakdown` entries must sum exactly to the aggregate token fields. A
`usageViolation` detail on a failed record means tokens were dropped or
double-counted somewhere in the pipeline. Failed cases can also return
`failureReasons`; the runner prints these inline, includes them in the final
failure summary, and writes them to the JSONL record. Cases may declare
provider/model exclusions for known capability gaps; these are recorded as
skips with the exclusion reason.
