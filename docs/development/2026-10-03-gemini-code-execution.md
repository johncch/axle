# Gemini Code Execution Parts

Working note for AXL-68, "Keep Gemini code execution output and built-in
tool parts" (0.33.0). There is still no architecture doc for provider
tools; the Gemini rows in `docs/architecture/provider-content.md` are the
normative record.

## Starting point

`code_execution` was a mapped provider tool on Gemini, and the model did run
code, but the adapter logged `executableCode` and `codeExecutionResult` as
unhandled parts and dropped them. No provider-tool event fired, the stored
message held only the text, and later turns sent nothing back.

## What the wire showed

Captured on 2026-10-03 with `scripts/capture-gemini-code-execution.ts`: a
computation with code execution on, then a follow-up that echoed the model's
parts back verbatim and asked a question that depends on the result.

| Model                    | Turn 1 parts, in order                                                                                                       | Turn 2                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `gemini-2.5-flash`       | `executableCode`, `codeExecutionResult`, text, text                                                                          | Accepted; answered from the output |
| `gemini-3-flash-preview` | `executableCode` + `thoughtSignature` + `id`, `codeExecutionResult` + same `id`, text, text, empty text + `thoughtSignature` | Accepted; answered from the output |

Each part arrives as its own streamed chunk. The 2.5 model gives the parts
no `id` and no signature. The Gemini 3 model gives the code part an `id`
and a signature, and the result part the same `id`. The Gemini 3 capture is
`packages/axle/tests/fixtures/gemini-code-execution.jsonl`.

Two items the ticket asked to check did not occur:

- No `thoughtSignature` on a text part that has text. The closing signature
  arrived on its own empty-text part, which the adapter already stores.
- No `toolCall` or `toolResponse` part. Google ties them to combining
  built-in tools with function calling, so a second capture
  (`--with-function`) declared a client function next to code execution.
  On `gemini-3-flash-preview` the model called the function, got its
  response, ran code, and answered, across three requests; every part was a
  `functionCall`, `executableCode`, `codeExecutionResult`, text, or a
  signature. Still no `toolCall`.

Both stay dropped and are marked "accepted until observed" in the provider
content doc. `thinking.md` no longer lists a text-part signature echo.

The combined capture found something else. Gemini 3 rejects a request that
has both a built-in tool and function declarations unless
`toolConfig.includeServerSideToolInvocations` is true, and Gemini 2.5
refuses the combination with any setting. Axle never set the flag, so a
Gemini agent with `code_execution` or `web_search` plus its own tools could
not run at all. The request builder now sets it whenever both kinds of tool
are present. This is outside the ticket's text but was the only way to
check the `toolCall` item.

## Decision: one `provider-tool` part holding both Gemini parts

`ProviderToolContinuity` gains `{ provider: "gemini"; parts: Part[] }`. The
`executableCode` part opens the provider-tool part and is stored alone in
`parts`; the `codeExecutionResult` part completes it and `parts` becomes
the pair. The converter spreads `parts` back into the model turn in the
position the provider-tool part holds, so the echo is byte-for-byte what
arrived, signature and ids included.

Alternatives not taken:

- Rebuild the parts from `input` and `result`. Would drop the signature,
  the ids and the stdout unless each got its own field; storing the parts
  is what the Anthropic and OpenAI adapters already do.
- A `provider-tool-result` part for the result. That part exists for a
  result that answers a call in an earlier message. Gemini runs the code
  inside one response, so the result always finds its call in the same
  message.

Pairing is on `id`, falling back to the most recent open call when the
result has none (the 2.5 shape). The part's `id` is the code part's `id`,
or `<responseId>:code_execution:<index>` when Gemini gives none, matching
how the web search part is named.

The signature-only check in the adapter had to be guarded: an
`executableCode` part with a `thoughtSignature` and no text matched it and
would have been stored as a signature-only thinking part. The code and
result branches now run before that check.

## Verification

- Adapter: a replay of the Gemini 3 fixture asserts the event order and the
  three provider-tool chunks, plus unit cases for an id-less result, a
  failed outcome, and text on both sides of the execution.
- Converter: a provider-tool part with Gemini continuity echoes its parts
  in order among the text; a part with OpenAI continuity is skipped.
- Request builder: a request with both tools sets
  `includeServerSideToolInvocations`; one with a provider tool alone does
  not.
- Live, 2026-10-03, `gemini-3-flash-preview` through `Agent` with
  `code_execution`: the three provider-tool events fired, the stored part
  held both Gemini parts with the signature and the stdout, and the
  follow-up "divide that sum by 7" answered from the stored output
  ("The remainder when 5,117 is divided by 7 is 0").

## Not done

- The stdout is reachable only through continuity. A normalized `output` on
  the success result, for callers and the CLI, is the follow-up to this
  change.
