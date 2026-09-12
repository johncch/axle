# Provider Checks

These checks run real provider calls against Axle's core public workflows. They
are intended as a publish smoke test, not as unit tests or performance
benchmarks.

Cases belong to one of two groups:

- `default`: the publish smoke set. Run before every release.
- `extended`: edge-case coverage (schema shapes, message formats, cache
  telemetry, compaction sizing). Slower and costlier; run on each minor release
  or when touching the subsystem a case covers.

## Usage

Run the default case group against the default provider set at their default
smoke models:

```bash
pnpm exec tsx checks/run.ts
# or
pnpm run checks
```

Run the default and extended groups together:

```bash
pnpm exec tsx checks/run.ts --extended
# or
pnpm run checks:extended
```

The default set is OpenAI, Anthropic, Gemini, and Together. OpenRouter is
available as an explicit alternative Chat Completions provider.

Providers run concurrently; cases within a provider run sequentially. Output
is pytest-style: one dot row per provider (`.` pass, `F` fail, `E` error,
`s` skip) with right-aligned progress, updated live on a TTY (each completed
row prints once when piped), followed by a `TOKENS` section with one line
per provider (input and output token totals, with cache and reasoning
breakdowns when non-zero, and how many of the run cases reported usage), a
`FAILURES` section with reasons and details, and a colored summary bar. JSONL records are appended in
completion order and carry `providerId` for grouping.

Run one provider:

```bash
pnpm exec tsx checks/run.ts --provider openai
```

Run a selected provider set:

```bash
pnpm exec tsx checks/run.ts \
  --provider openrouter \
  --provider together
```

Provider flags may also be comma-separated.

Run every provider, including OpenRouter:

```bash
pnpm exec tsx checks/run.ts --all
```

Override the model for one provider:

```bash
pnpm exec tsx checks/run.ts --provider openai --model gpt-5.4
```

Apply a portable reasoning setting (`default`, `off`, `on`, `low`, `medium`,
`high`) to every case that forwards `requestOptions`:

```bash
pnpm exec tsx checks/run.ts --provider anthropic --model claude-opus-4-8 --reasoning high
```

Run selected cases. A selection runs regardless of group, and a trailing `*`
matches an id prefix:

```bash
pnpm exec tsx checks/run.ts --case generate-basic,agent-basic
pnpm exec tsx checks/run.ts --case "agent-*"
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

`BRAVE_API_KEY` is required for every run. The fallback is configured once
at runner startup so native web-search providers are exercised while a fallback
is present, and fallback providers such as Together use Brave automatically.
The PDF attachment case is excluded because Together's Chat Completions API
does not accept PDF file parts. Override Together's default smoke model with
`TOGETHER_MODEL`.

Run the native OpenRouter search path:

```bash
pnpm exec tsx checks/run.ts \
  --provider openrouter \
  --case stream-web-search
```

Run the Together + Brave fallback path:

```bash
pnpm exec tsx checks/run.ts \
  --provider together \
  --case stream-web-search
```

Run specific configuration against a set of models

```
for model in claude-opus-4-8 claude-opus-4-7 claude-sonnet-4-6 claude-opus-4-6
do
  pnpm exec tsx checks/run.ts \
    --provider anthropic \
    --model "$model" \
    --case generate-basic \
    --reasoning on \
    --out "output/checks/anthropic-${model}-reasoning.jsonl"
done
```

## Cases

### Default

- `generate-basic`
- `stream-basic`
- `generate-instruct-json`
- `stream-instruct-json`
- `generate-instruct-history`
- `agent-basic`
- `agent-instruct-json`
- `agent-multiturn-history`
- `agent-compaction` (`PromptCompactor` creates bounded history; archive retained; conversation continues)
- `agent-compaction-triggers` (one callback invoked at configured before/after turn boundaries)
- `generate-tool`
- `generate-deferred-tool-file`
- `generate-unsupported-tool-file` (Chat Completions binary tool-result fallback)
- `stream-tool`
- `agent-tool`
- `agent-stop` (stop() finishes the active tool batch; the queued send continues)
- `generate-parallelized-tool`
- `agent-subagent-tool` (including child usage attribution)
- `agent-tool-fatal` (fatal tool error terminates the send with usage intact)
- `agent-subagent-abort` (cancel mid-delegation; no child conversation leak)
- `agent-parallel-subagents` (parallelize + createAgentTool fan-out)
- `reasoning-off` (explicit disable; skipped on Fable, which cannot turn thinking off)
- `reasoning-efforts` (low, medium, and high each accepted on the target model)
- `reasoning-stream-effort`
- `reasoning-tool-continuity` (thinking carried back through a tool turn)
- `stream-web-search`
- `instruct-text-reference`
- `instruct-context`
- `generate-image-file`
- `generate-pdf-file` (providers whose API accepts PDF parts)

### Extended

Tool schema shapes (`tool-schema-*`): each sends one probe tool whose
parameter schema exercises a shape providers have rejected or mangled, and
checks the model calls it with input that satisfies the Zod schema.

- `tool-schema-required-only`
- `tool-schema-optional-string`
- `tool-schema-optional-boolean` (matches `edit_file.replace_all?`)
- `tool-schema-optional-number` (matches `bash.timeout_ms?`)
- `tool-schema-nested-optional`
- `tool-schema-array-object-optional`
- `tool-schema-nullable-required`
- `tool-schema-nullish-optional`
- `tool-schema-defaulted-optional`
- `tool-schema-loose-object`

Instruct JSON shapes (`instruct-json-*`): structured-output schemas beyond
the flat object the default group uses. Each must parse, and some assert a
count or literal the prompt demanded.

- `instruct-json-primitive-arrays`
- `instruct-json-nested-object`
- `instruct-json-array-of-objects`
- `instruct-json-optional-field`
- `instruct-json-hostile-string` (quotes, braces, code fence, XML-like text)
- `instruct-json-prose-prone`

Message formats (`format-*`): normalized citation and thinking shapes on the
assistant message. Provider coverage is uneven because providers expose
different surfaces; each case lists the providers it runs on and skips the
rest.

- `format-web-citations` (OpenAI, Gemini hosted search)
- `format-document-citations` (Anthropic PDF input)
- `format-thinking-continuity` (OpenAI encrypted reasoning, Anthropic
  signature, Gemini summary)
- `format-thinking-hidden` (Anthropic hidden thinking: continuity only, not redacted)
- `format-thinking-stream` (a raw or summary delta required for Anthropic,
  OpenRouter, and Together, which stream thinking text)

Reasoning routes (`reasoning-route-*`, `reasoning-unsupported-error`): the
request syntax Axle picks per model generation, pinned to models the default
targets don't cover. Normative in `docs/architecture/reasoning.md`.

- `reasoning-route-legacy` (Anthropic Haiku 4.5 budget, Gemini 2.5 budget;
  reasoning tokens must be reported)
- `reasoning-route-modern` (Anthropic Sonnet 4.6 adaptive, Gemini
  `flash-lite-latest` named level)
- `reasoning-unsupported-error` (`off` on Fable and Gemini 3 Pro must surface
  the provider's rejection)

Cache telemetry (`cache-*`): provider cache counters surface on `usage`.

- `cache-prompt-reuse` (OpenAI `prompt_cache_key`, Anthropic `cache_control`
  with `cacheWriteIn` on the first call)
- `cache-gemini-cached-content` (explicit cached-content resource passed via
  `providerOptions.cachedContent`; created and deleted by the case)

Compaction sizing (`compaction-*`): the `agent-compaction` default case
proves the loop works; this one observes the size ladder itself.

- `compaction-size-ladder` (result under threshold, stamped messages; summary
  word count, overshoot, and summarizer call count in details, where 1 call
  means no rewrite pass fired)

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

`format-gemini-delayed-citations` injects Gemini response chunks with text, a
trailing thought signature, and delayed grounding metadata. It verifies citation
attachment and omitted zero offsets through both `generate()` and `stream().final`
without network requests.

### Deterministic error contracts

`stream-error-contract` and `stream-escaped-abort` use injected providers and
exercise both `generate()` and `stream().final` without network requests. They
verify error diagnostics, raw payload identity, usage, and completed conversation
state after an escaped provider abort.

Vendor safety blocks, failed response events, SDK exceptions, preparation errors,
and cancellation before the first chunk are injected in
`packages/axle/tests/providers/streaming-errors.test.ts`. Live providers cannot
reliably produce these exact failure conditions; these fixtures cover the vendor
adapters and public API together. The live harness does not validate actual
socket cancellation or provoke provider safety blocks.
