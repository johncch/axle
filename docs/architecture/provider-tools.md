# Provider tools

**Status**: current · **Last design revision**: 2026-10-09 (0.34.0)

This document is normative for how a provider tool request reaches a
provider and who is responsible for serving it. Code and tests are built
against it; divergence is a defect. Vocabulary is defined in
[terminology.md](../terminology.md). How a hosted tool's activity is stored
in a message is in [provider-content.md](./provider-content.md).

## Invariants

1. **A provider tool is a request by portable name.** The caller passes
   `{ type: "provider", name, config? }` in `providerTools`. The name says
   what is wanted (`web_search`, `code_execution`), not how it is served.
2. **The provider owns every provider tool.** Core hands `providerTools` to
   the provider unchanged on every request. Core does not read the names,
   does not ask a provider what it supports, and holds no fallback. Each
   provider decides how to serve a name: as a tool the vendor hosts, as an
   executable tool the provider brings, or not at all.
3. **A provider may bring executable tools.** `AIProvider.tools` is an
   optional `ExecutableTool[]`. When the model calls a tool whose name is
   not among the caller's tools, the loop runs the provider's tool of that
   name. This lookup is the only thing core knows about them: it does not
   know which tools a provider brings or which provider tool they serve. A
   caller's tool wins over a provider's tool of the same name.
4. **A brought tool is an ordinary tool call, and is reported as one.** It
   produces `tool:*` events, a tool-call part and a tool message. Nothing
   dresses it up as a hosted tool. Switching from a provider that hosts
   search to one that brings it changes the transcript from `provider-tool`
   parts to tool calls, because that is what happened.
5. **There is no process-wide configuration.** What a provider can do is
   fixed when the provider is constructed. Two providers in one process can
   serve the same name differently.
6. **`chatCompletions()` serves `web_search` from a tool attached at
   construction.** `ChatCompletionsOptions.webSearch` takes an
   `ExecutableTool`; `braveWebSearch()` returns one. The provider lists it
   in `tools` (invariant 3). When a request carries the `web_search`
   provider tool, the provider sends the attached tool to the model as a
   function tool and drops `web_search` from the provider tools it goes on
   to translate. An attached tool is used wherever it is attached,
   including on OpenRouter, which hosts a search of its own.
7. **A provider tool nothing serves fails the request.** A
   `chatCompletions()` provider with no vendor that hosts tools, asked for a
   provider tool it has nothing attached for, fails before any HTTP request.
   The adapter throws a plain `Error`, as it does for any request it cannot
   build, so the result is `ok: false` with `error.kind` `"model"` and a
   message naming the tool. There is no error code. It is never dropped
   silently.
8. **`config` belongs to a hosted tool.** It is merged into the vendor's
   tool definition. A brought tool has no vendor definition to merge it
   into, so `config` on a provider tool served by a brought tool is ignored.

## What each provider does with a name

As of 2026-10-09. The middle columns are what Axle sends; they are read from
the adapters, not re-checked against vendor documentation on this date.

| Provider                               | `web_search`                                                                 | `code_execution`                  | Any other name                              |
| -------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------- |
| `anthropic()`                          | Hosted: `type: "web_search_20260318"`, `allowed_callers: ["direct"]`, config | Hosted: `code_execution_20260521` | Sent as `type: <name>`; the API decides     |
| `openai()`                             | Hosted: `type: "web_search"`, config                                         | Hosted: `code_interpreter`        | Sent as `type: <name>`; the API decides     |
| `gemini()`                             | Hosted: `googleSearch: <config>`                                             | Hosted: `codeExecution: <config>` | Sent as `<name>: <config>`; the API decides |
| `chatCompletions()`, OpenRouter vendor | Attached tool if one is attached, else hosted: `openrouter:web_search`       | Warned and skipped                | Warned and skipped                          |
| `chatCompletions()`, Together vendor   | Attached tool if one is attached, else fails                                 | Fails                             | Fails                                       |
| `chatCompletions()`, no vendor         | Attached tool if one is attached, else fails                                 | Fails                             | Fails                                       |

The OpenRouter vendor's warn-and-skip for names it does not map predates
this design and is the one place a provider tool is still dropped rather
than failed.

## Design rationale (2026-10-09)

From 0.25.0 to 0.33.0 web search on a provider without a hosted search was
a process-wide setting. `configureAxle({ webSearchFallback })` stored a
backend in a module variable, `stream()` snapshotted it at start, and
`resolveTools` asked the provider `resolveProviderToolName("web_search",
model)` to learn whether search was "native". If it was not, the loop
removed the provider tool, wrapped the backend in an executable tool and
ran that instead, or threw `WEB_SEARCH_FALLBACK_NOT_CONFIGURED`.

That put a per-provider fact in three places that were not the provider: a
global, a capability question on the `AIProvider` interface that all four
providers had to answer, and a branch in the loop that named `web_search`.
The global was the only field `AxleConfiguration` ever had.

The goal of the feature is narrow: a caller who requests `web_search` and
then switches provider should not hit an error. Everything else was
machinery. The person who constructs a Together provider knows it has no
search, so that is where the search is attached, and the provider is the
only code that needs to know.

The loop still executes the search, because the loop is what executes
tools. So core keeps one generic lookup (invariant 3) and nothing that
mentions search.

## Rejected alternatives

- **Process-wide configuration** (2026-10-09): the 0.25.0 design, described
  above. Removed.
- **A capability query on the provider, resolved by the loop**
  (2026-10-09): `resolveProviderToolName` and the native-first branch in
  `resolveTools`. It existed only to choose between native and fallback;
  with the provider owning the tool there is nothing to choose.
- **A `webSearch` field on `AIProvider`, swapped in by `resolveTools`**
  (2026-10-09): AXL-89 as first written. It moved where the backend was
  stored and kept the web-search branch in the loop.
- **The provider runs the search itself and reports `provider-tool`
  parts** (2026-10-09): `chatCompletions()` would call the model, run the
  search and call again inside one step, so a Together transcript matched
  an Anthropic one. It needs a request loop in the adapter and a converter
  that replays stored `provider-tool` parts as tool calls. Rejected because
  parity is not the goal: the transcript should show that the search ran
  client-side.
- **A `WebSearchBackend` interface wrapped into a tool by core**
  (2026-10-09): `braveWebSearch()` returned a backend with a `search`
  method and core wrapped it. A search is a tool; the option takes one.
- **Hosted search first on OpenRouter when a tool is also attached**
  (2026-10-09): the old native-first order. An attached tool is an explicit
  choice by the person who built the provider, and "attached means used"
  needs no vendor rule.
