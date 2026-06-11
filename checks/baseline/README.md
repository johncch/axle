# Baseline Provider Checks

These checks run real provider calls against Axle's core public workflows. They
are intended as a publish smoke test, not as unit tests or performance
benchmarks.

## Usage

Run all configured providers at their default smoke models:

```bash
pnpm exec tsx checks/baseline/run.ts
```

Run one provider:

```bash
pnpm exec tsx checks/baseline/run.ts --provider openai
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
failure summary, and writes them to the JSONL record.
