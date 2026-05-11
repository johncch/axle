# Structured Output Benchmark

This benchmark runs real model calls against the `Instruct` structured-output
cases. It is intentionally outside Vitest because it can use API keys, cost
money, and produce comparative JSONL output.

The benchmark uses the JSON-based `Instruct` output format.

## Usage

Run every configured target:

```bash
pnpm exec tsx benchmarks/structured-output/run.ts
```

API keys are loaded from your shell environment or from the repo-local `.env`
file:

```bash
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=...
```

Run one target by short id or exact model slug:

```bash
pnpm exec tsx benchmarks/structured-output/run.ts qwen-3-6-35b-a3b
pnpm exec tsx benchmarks/structured-output/run.ts qwen/qwen3.6-35b-a3b
```

Select cases or repeats when needed:

```bash
pnpm exec tsx benchmarks/structured-output/run.ts \
  --target gpt-5-4-mini \
  --case nested-object,array-of-objects \
  --repeats 3 \
  --out output/benchmarks/json-baseline.jsonl
```

Configured targets:

- `gpt-5-4-mini`: `openai:gpt-5.4-mini`
- `haiku-4-5`: `anthropic:claude-haiku-4-5-20251001`
- `gemini-3-flash`: `gemini:gemini-3-flash-preview`
- `qwen-3-6-35b-a3b`: `chatcompletions:qwen/qwen3.6-35b-a3b`
- `gemma-4-26b-a4b-it`: `chatcompletions:google/gemma-4-26b-a4b-it`
- `ministral-3-8b`: `chatcompletions:mistralai/ministral-8b-2512`
- `mistral-small-4`: `chatcompletions:mistralai/mistral-small-2603`
- `deepseek-v4-flash`: `chatcompletions:deepseek/deepseek-v4-flash`
- `minimax-m2`: `chatcompletions:minimax/minimax-m2`

## Output

The runner writes JSONL records with:

- provider and model
- case id and description
- success, parse-error, model-error, or exception status
- raw model text
- parsed response when parsing succeeds
- usage and duration
