# ChatCompletions Stream Error Coverage

The ChatCompletions streaming error fix is covered by deterministic tests in
`packages/axle/tests/providers/chatcompletions/createStreamingRequest.test.ts`
and `packages/axle/tests/providers/chatcompletions/createStreamingAdapter.test.ts`.

Harness coverage under `checks/` is not practical for this change because the
behaviors require provider-controlled malformed SSE frames, mid-stream upstream
error frames, or a transport drop during tool-call argument buffering. The live
checks cannot reliably force OpenAI-compatible providers or OpenRouter to emit
those failure modes on demand.

The request tests still exercise the public `stream()` API for upstream error
frames and truncated tool-call argument streams, so the caller-visible
`ok: false` model error result is covered without depending on live provider
fault injection.
