# Tool-call parameter checks

Live-provider checks for Axle function tools with different parameter-schema
shapes. These recreate the class of failure where a provider accepts the tool
definition only after schema serialization is compatible with that provider.

The default run targets all configured providers, so the same tool schemas can
be compared across adapters.

```bash
pnpm exec tsx checks/tool-calls/run.ts
```

Run a subset of providers:

```bash
pnpm exec tsx checks/tool-calls/run.ts --provider openai,openrouter
```

Run streaming as well as non-streaming:

```bash
pnpm exec tsx checks/tool-calls/run.ts --surface both
```

Run one case:

```bash
pnpm exec tsx checks/tool-calls/run.ts --case optional-boolean
```

The runner writes JSONL records to `output/checks/tool-calls-*.jsonl` and exits
non-zero if any selected case fails.

## Cases

- `required-only` — only required scalar parameters
- `optional-string` — top-level optional string parameter
- `optional-boolean` — optional boolean parameter, matching `edit_file.replace_all?`
- `optional-number` — optional number parameter, matching `bash.timeout_ms?`
- `nested-optional` — optional properties inside a nested object
- `array-object-optional` — optional properties inside objects in an array
- `nullable-required` — required nullable parameter
- `nullish-optional` — parameter accepting `undefined` or `null`
- `defaulted-optional` — defaulted parameter
- `loose-object` — object schema allowing arbitrary additional keys

## Environment

Set the API key for each selected provider:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `OPENROUTER_API_KEY`
- `TOGETHER_API_KEY`

`TOGETHER_MODEL` may be set to override the default Together model.
