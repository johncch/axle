# Providers own provider tools (AXL-89)

Working note for the change that removed the process-wide web search
fallback and put the search on the provider. Normative text is in
`docs/architecture/provider-tools.md`.

## Starting point

Since 0.25.0 (`2026-06-11-web-search-fallback.md`) a provider without a
hosted search got one from `configureAxle({ webSearchFallback })`.
`stream()` snapshotted the global, `resolveTools` asked the provider
`resolveProviderToolName("web_search", model)` whether search was native,
and the loop swapped the provider tool for an executable one or threw
`WEB_SEARCH_FALLBACK_NOT_CONFIGURED`. `webSearchFallback` was the only field
`AxleConfiguration` ever had, and `checks/run.ts` was its only caller; the
CLI never wired it.

## The design conversation

The ticket as first written kept the mechanism and moved the storage: a
`webSearch` backend on `AIProvider`, set by `chatCompletions()`, read by
`resolveTools` in place of the global, native still first. That was
rejected on sight. The complaint was the branch in `resolveTools` itself,
not where its input lived, and the ticket was about simplification.

The reframing: the person who builds a Together provider knows it has no
search, so they attach one, and from then on that is the provider's
`web_search`. Nothing is resolved before the provider. Anthropic, OpenAI
and Gemini do nothing.

Two attempts at that overshot or undershot:

- Having `chatCompletions()` run the search inside the step and report
  `provider-tool` chunks, so a Together transcript matched Anthropic's. This
  was more machinery, for a parity nobody asked for. The stated goal is only
  that switching providers does not error; a transcript that shows a
  client-side tool call is the truth.
- Keeping a small swap in `resolveTools` keyed on `web_search`. Smaller
  than before, but still the block the ticket exists to delete.

What held: the adapter makes the swap on the wire, and the loop gets one
generic lookup, "a tool call the caller's tools do not have is run against
the provider's tools". Core then has no line that mentions search.

With the tool living on the provider, the `WebSearchBackend` interface was
a layer with one implementation and a wrapper. `braveWebSearch()` returns
the tool, and `webSearch` takes any `ExecutableTool`.

## What landed

- `packages/axle/src/config.ts` deleted with `configureAxle`,
  `AxleConfiguration` and the snapshot in `stream()`.
- `AIProvider.resolveProviderToolName` removed from the interface and the
  four providers. `AIProvider.tools` added.
- `resolveTools` is the duplicate-name check and a lookup that falls back
  to `provider.tools`.
- `chatCompletions({ webSearch })`: the tool goes in `tools`, and
  `createStreamingRequest` sends it as a function tool when `web_search` is
  requested. An attached tool is used on OpenRouter too.
- A `chatCompletions()` provider asked for a provider tool it cannot serve
  fails before the request with a plain adapter `Error`, where it
  used to warn and drop (or, on Together, drop silently).
- `braveWebSearch()` returns an `ExecutableTool`; `WebSearchBackend` and
  its request, response and context types are gone.
- `checks/`: Brave is attached to the `together` and `ollama` targets, so
  `BRAVE_API_KEY` is needed only for those. `stream-web-search` still runs
  on every chat target and lost its "native provider used the fallback"
  failure, which can no longer happen.

## Left as is

- OpenRouter still warns and skips a provider tool name it does not map.
- Through raw `stream()`, an executable `web_search` passed beside the
  `web_search` provider tool is not rejected; `ToolRegistry` rejects the
  pair for an `Agent`. This predates the change.
- No `webSearch` key on `cli.yaml` provider profiles.
