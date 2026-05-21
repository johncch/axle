# Cache Telemetry Checks

These are live provider checks for Axle usage telemetry. They intentionally
exercise provider-specific cache paths and verify that Axle surfaces the
provider's returned counters on `result.usage`.

They are not normal unit tests and they are not a portable benchmark. Run them
one provider at a time:

```bash
pnpm exec tsx checks/cache-telemetry/run.ts
```

Run selected providers:

```bash
pnpm exec tsx checks/cache-telemetry/run.ts --provider openai,anthropic
```

Keep running after a provider fails:

```bash
pnpm exec tsx checks/cache-telemetry/run.ts --continue
```

Or run one provider script directly:

```bash
pnpm exec tsx checks/cache-telemetry/openai.ts
pnpm exec tsx checks/cache-telemetry/anthropic.ts
pnpm exec tsx checks/cache-telemetry/gemini.ts
pnpm exec tsx checks/cache-telemetry/chatcompletions.ts
```

Required environment variables:

```bash
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=...
```

Optional model overrides:

```bash
OPENAI_CACHE_MODEL=...
ANTHROPIC_CACHE_MODEL=...
GEMINI_CACHE_MODEL=...
CHAT_COMPLETIONS_CACHE_MODEL=...
CHAT_COMPLETIONS_CACHE_BASE_URL=...
```

Expected behavior:

- `openai.ts` repeats a long prompt with `prompt_cache_key` and expects the
  second call to report `cachedIn`.
- `anthropic.ts` sends top-level `cache_control` and expects the first call to
  report `cacheWriteIn`, then the second call to report `cachedIn`.
- `gemini.ts` creates an explicit cached-content resource, calls Axle with
  `options.cachedContent`, expects `cachedIn`, then deletes the cache.
- `chatcompletions.ts` repeats a long prompt against an OpenAI-compatible
  endpoint and reports whether `prompt_tokens_details.cached_tokens` appears.
  Set `CHAT_COMPLETIONS_CACHE_REQUIRE=true` to make missing `cachedIn` a hard
  failure for endpoints expected to support it.
