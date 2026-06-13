# OpenRouter Tool Result Experiment

This check probes whether OpenRouter models can consume image and PDF content
inside Chat Completions tool-result messages.

It sends raw OpenRouter payloads because Axle's generic Chat Completions adapter
intentionally converts binary tool results to a text fallback. The experiment
does not change that behavior.

Each attachment is tested in two placements:

- `tool`: structured content in a `role: "tool"` message
- `user`: the same structured content in a `role: "user"` control message

Each placement supports:

- image data URL
- image public URL
- PDF data URL
- PDF public URL

The expected image answer is `Carnegie Mellon University`. The expected PDF
answer is `Terry Winograd`. A successful HTTP response is reported separately
from evidence that the model actually inspected the attachment.

## Usage

List models and probes:

```bash
pnpm exec tsx checks/openrouter-tool-results/run.ts --list
```

Run a small comparison:

```bash
pnpm exec tsx checks/openrouter-tool-results/run.ts \
  --models anthropic/claude-sonnet-4.6,openai/gpt-5.4-mini,minimax/minimax-m3 \
  --probes tool-image-data-url,user-image-data-url,tool-pdf-data-url,user-pdf-data-url
```

Run one model with every probe:

```bash
pnpm exec tsx checks/openrouter-tool-results/run.ts \
  --model minimax/minimax-m3
```

Run a configured group:

```bash
pnpm exec tsx checks/openrouter-tool-results/run.ts \
  --model fast \
  --probes tool-image-data-url,user-image-data-url
```

Run the full model and probe matrix:

```bash
pnpm exec tsx checks/openrouter-tool-results/run.ts --all
```

`OPENROUTER_API_KEY` is loaded from the shell environment or repo-local `.env`.

The runner writes:

- JSONL records with response details and advertised OpenRouter model metadata
- a Markdown matrix summarizing all model/probe combinations

Statuses:

- `seen`: HTTP succeeded and the expected fixture answer was present
- `accepted-unseen`: HTTP succeeded but the expected answer was absent
- `rejected`: OpenRouter or the upstream provider returned an error, including
  errors wrapped in an HTTP 200 response
- `error`: the experiment failed before receiving a valid HTTP response

PDF controls may invoke OpenRouter's file parser. See OpenRouter's PDF pricing
before running the full matrix. The current fixture is one page, but parser
minimum charges may still dominate the model cost.
