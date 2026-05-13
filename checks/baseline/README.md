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
- `stream-tool`
- `agent-tool`
- `reasoning-false`
- `instruct-text-reference`

The runner writes JSONL records to `output/checks/` and exits non-zero if any
case fails or errors.
