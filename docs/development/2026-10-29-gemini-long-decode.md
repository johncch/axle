# Gemini `CONTINUATION` is continued by the SDK, not by Axle

Working note for AXL-92. The ticket asked for an adapter-owned loop that
carries Gemini's `continuationToken` the way the Anthropic adapter carries
a `pause_turn`. The loop was not written; the SDK floor was raised instead.

## What the ticket got wrong, and how

The ticket's three unknowns were answered by Google's long-decode guide
(updated 2026-10-13) before any capture ran, and its first step could not
have worked:

- `CONTINUATION` is a Gemini 4 feature, `gemini-4-argon` only. Five
  attempts on `gemini-3.8-flash` either refused the task as too long, hit
  the recitation filter on counting in words, or self-limited at two
  thousand tokens; none approached a server limit.
- It fires only with `maxOutputTokens` set _above_ 65,536, the opposite of
  the ticket's "no `maxOutputTokens`". The cap is cumulative over hops.
- The resume request is the original request unchanged plus the latest
  token in `config`. No partial output is appended. `MAX_TOKENS` also
  returns a token; resuming from it needs a higher cap.

## The reversal

The first plan, after reading the guide, was still to own the loop, for
parity with Anthropic and a usage row per hop. A side note pointed out that
core declares `@google/genai` as `^2.15.0`, so a fresh install already got
2.32.0, where the SDK runs the loop by default, and the adapter-owned loop
would never run for most consumers without turning that off. The changelog
for 2.29.0 through 2.32.0 showed the SDK's loop accumulating usage across
hops, clearing the intermediate finish reasons, resuming from checkpoint
tokens when a stream drops, and retrying dropped hops. Re-implementing that
to keep per-hop rows was not worth it. Decision: raise the floor to
`^2.31.0` in core, the CLI and `checks/`, keep automatic continuation on,
and change no adapter code.

## What the wire showed

Two captures on `gemini-4-argon`, `maxOutputTokens: 131072`, a system
instruction stating the limit so the model would not refuse, and a
computed numeric table the recitation filter leaves alone.

Raw hops (SDK 2.28.0, `checks/captures/capture-gemini-continuation.ts`):

- Hop 1 streamed 1,262 chunks and stopped at exactly 65,536 output tokens
  with `CONTINUATION`. Checkpoint tokens began at 32,768 tokens and came
  every ~5,000 after; from that point the server sent one chunk per
  checkpoint rather than small deltas. The final chunk held an empty text
  part with a thought signature and the token (124k chars).
- The token-only resume with the same contents was accepted. It continued
  mid-line under a new response id with nothing re-emitted. Its
  `promptTokenCount` was 65,705: the whole prior context billed as input.
  It ran to the cumulative cap and ended `MAX_TOKENS` with a token.

SDK loop (2.32.0, `--automatic`, 3,000 lines so the answer fits the cap):

- 1,259 chunks under two response ids; the only finish reason was the
  final `STOP`. Fifteen checkpoint tokens passed through untouched.
- The hop boundary arrived as the empty-text-plus-signature part with no
  finish reason. The adapter turns it into a signature-only thinking part,
  so the stored message is text, signature, text.
- The last chunk's `usageMetadata` was summed over both hops: prompt
  65,874 (169 + 65,705), candidates 94,921. Axle's adapter reads the last
  chunk, so `in: 65874, out: 94921` is what a caller sees, and it is the
  billed figure.

The trimmed SDK-loop stream is `packages/axle/tests/fixtures/gemini-long-decode.jsonl`;
the adapter test replays it and asserts the part sequence, one `start`, a
`Stop` finish and the summed usage. A second test keeps the
`automaticContinuation: false` path honest: `incomplete`, typed
`CONTINUATION`, token on `raw`.

## Cost

Every resumed hop re-reads all earlier output at the input rate. Today's
two-hop runs each billed about 66,000 input tokens on top of their output,
roughly $0.15 to $0.25 at launch pricing. The input share grows with the
number of hops. Recorded in the library README, the migration note and the
CLI changelog, since a caller who raises `maxOutputTokens` on Argon triggers
the hops without seeing them.

## Verification

`generate-long-decode` in `checks/cases/core.ts` (extended, Google only,
skipped off Gemini 4) ran through Axle against `gemini-4-argon`: one
assistant message, `stop`, 3,000 lines, `in 65874 out 94921`, 731 seconds.
