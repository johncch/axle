# Compaction Size-Ladder Check

Runs `PromptCompactor` against real models on a synthetic over-threshold
conversation and verifies the size ladder end to end: the result shrank
under the threshold, both messages carry compaction stamps, and the summary's
word count is reported against the request (with the summarizer call count —
1 means no rewrite pass fired). The baseline suite has a broader compaction
case; this check exists to observe the sizing behavior itself, including
thinking-by-default models that share their reasoning budget with
`maxOutputTokens`.

## Usage

```bash
pnpm exec tsx checks/compaction/run.ts                       # default provider set
pnpm exec tsx checks/compaction/run.ts -p anthropic
pnpm exec tsx checks/compaction/run.ts -p openrouter -m z-ai/glm-4.6
pnpm exec tsx checks/compaction/run.ts --all
```

Providers and default models come from `checks/baseline/providers.ts`; API
keys load from `.env` at the repo root. Exit code is non-zero when any
target fails.
