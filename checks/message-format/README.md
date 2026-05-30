# Message Format Checks

Real-provider checks for Axle's normalized citation and thinking formats.

These checks are intentionally gated by provider API keys and are not part of
the unit test suite.

```sh
pnpm exec tsx checks/message-format/run.ts
pnpm exec tsx checks/message-format/run.ts --provider openai
pnpm exec tsx checks/message-format/run.ts --provider anthropic --case anthropic-redacted-thinking
```

The runner writes JSONL records to `output/checks/message-format-*.jsonl`.

Cases cover:

- text citations from provider web/search grounding
- document citations from Anthropic PDF inputs
- normalized citation source shape fixtures
- redacted thinking
- thinking summaries
- streamed thinking text
- provider continuity payloads for OpenAI, Anthropic, and Gemini

Provider coverage is intentionally uneven because the providers expose different
citation surfaces. OpenAI and Gemini reliably exercise web citations through
hosted search/grounding. Anthropic exercises web citations through hosted search
and document citations through the PDF fixture in `examples/data`.
