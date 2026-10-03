# Code Execution Output

Working note for the follow-up to AXL-68 (0.33.0): mapping `code_execution`
on Anthropic and surfacing what a provider code execution printed. The
Gemini work that preceded it is in
`2026-10-03-gemini-code-execution.md`.

## Starting point

After AXL-68 all three providers stored their code execution objects in the
`provider-tool` part's continuity, so the stdout survived, but a caller had
to branch on the provider to find it: `continuity.result.content.stdout`
on Anthropic, `continuity.item.outputs[].logs` on OpenAI,
`continuity.parts[1].codeExecutionResult.output` on Gemini. The turn's
action result had `content` for local tool output and nothing for provider
tools, so the CLI showed a code execution ran and nothing of what it did.

Anthropic was the odd one out for a second reason: `code_execution` was
mapped on OpenAI and Gemini but not there. No decision recorded that; the
mapping table got `web_search` when #38 modernized the search versions and
code execution was never added.

## Anthropic mapping

`code_execution` maps to `code_execution_20260521`, the newest version in
the installed SDK. Observed on 2026-10-03 (`claude-haiku-4-5`): asked to
write a script and run it, Claude sent a `text_editor_code_execution`
`create`, then a `bash_code_execution` run, each as its own
`server_tool_use` block with a matching result block, and a follow-up that
echoed both pairs was accepted.

The adapter needed no change to store these. Every `server_tool_use` was
already a `provider-tool` part under the block's name, failures were
already read from the `error_code` field, and the whole block was already
continuity. What was added:

- `{ type: "command", command }` as a `ProviderToolInput` shape, filled
  from `bash_code_execution`. Text editor calls carry no `input`.
- The `caller` relationship stays inside continuity; surfacing it is
  AXL-71.

Rejected: Axle names for the sub-tools. They are Anthropic's server tools,
and the adapter is name-agnostic by design, so a tool Anthropic adds later
is stored without a change here.

## Decision: `output` on the success result, string or `ConsoleOutput`

```ts
type ProviderToolResult =
  | { type: "success"; output?: string | ConsoleOutput }
  | { type: "error"; error: { type: string; message: string } };

interface ConsoleOutput {
  stdout: string;
  stderr?: string;
  exitCode?: number;
}
```

The union tells the truth about the wire. Gemini and OpenAI return one
stream: Gemini's `output` is stdout on success and stderr mixed with stdout
on failure; OpenAI's `logs` is one stream too. Anthropic's bash and code
results carry `stdout`, `stderr` and `return_code` apart. A string says
"one stream"; the object says "separated". Naming the single stream
`stdout` would have been wrong on a Gemini failure, and a renderer could
not have told.

`exitCode` is there because Anthropic marks failure only through
`error_code`. A script that exits 1 comes back as a normal result with
`return_code: 1` and a `success` result, which is the case a human most
wants flagged. `stderr` is omitted when empty.

Rejected: always `{ stdout, stderr? }`, with the providers that do not
separate filling `stdout`. Simpler for renderers, but a lie on two of three
providers. Rejected: a `stderr` field for local tools. A client tool returns
one `content` to the model and the turn shows what the model saw; a
presentation-only stream the model never gets is a different design, and
MCP has no stderr channel either.

Out of scope: output on a failed run. Gemini's mixed logs and OpenAI's
`logs` on a `failed` item are the most useful thing to show when code
fails, but the turn's error result has no content slot and adding one
touches every action kind. Also out of scope: OpenAI's `image` outputs and
Anthropic's written files (`file_id` entries), per the README's rule that
Axle has no multi-modal output.

## The path to the turn

`provider-tool:complete` on the stream carries `output`. The turn builder
puts it in the action's existing `result.content`, whose type widens from
`string | ToolResultPart[]` to `string | ConsoleOutput | ToolResultPart[]`.
Local tools are unchanged. The CLI's Ink renderer shows the first line of
stdout dimmed, or the first line of stderr in red with the exit code when
it is non-zero; the plain renderer prints no result content for any action
and still does not. This is the one breaking change here and is recorded in
`docs/0.33.0-migration.md`.

## OpenAI `include`

The code execution check's first OpenAI run stored `outputs: null`. The
Responses API returns code interpreter outputs only when the request lists
`code_interpreter_call.outputs` in `include`. The request builder adds it
whenever a provider tool resolves to `code_interpreter`.

The same run logged `response.code_interpreter_call.completed` as an
unhandled event. The code interpreter's progress and code-delta events
carry nothing the item's `done` event does not, so they join the search
progress events as no-ops.

## Verification

- Adapter tests on all three providers assert `output`: the Gemini fixture
  replay, an OpenAI item with mixed `logs` and `image` outputs, and an
  Anthropic bash result with stderr and one with an empty stderr and a
  non-zero exit.
- Turn builder test: `output` on the stream event lands in
  `result.content`.
- Request tests: Anthropic maps `code_execution` with no default callers;
  OpenAI sends the include for code execution and no include otherwise.
- CLI: `formatActionResult` tests for a string, a clean run, and a failed
  exit.
- Check `stream-code-execution-round-trip` runs on OpenAI, Anthropic and
  Gemini and now reads the sum from `result.output`. Passed on 2026-10-03
  on `gpt-6-luna`, `claude-haiku-4-5` and `gemini-flash-lite-latest`.
