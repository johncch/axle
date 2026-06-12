# Native-First Web Search Fallback

Axle treats `providerTools: [{ type: "provider", name: "web_search" }]` as a
portable capability request.

Resolution is native-first:

1. Providers that resolve `web_search` receive a run-scoped provider tool carrying
   both the portable name and provider-native name.
2. Providers without native support receive an executable `web_search` tool
   backed by `configureAxle({ webSearchFallback })`.
3. Missing fallback configuration fails before a model request is sent.

Global configuration is snapshotted at the `generate()`, `stream()`, or
`Agent.send()` call boundary. Active runs are not affected by later
configuration changes.

The first fallback backend uses Brave Search's LLM Context endpoint. It returns
normalized results with a title, URL, and query-relevant extracted passages.
The fallback emits ordinary tool events; native search continues to emit
provider-tool events and native citations.

This design deliberately avoids a general model capability registry. Native
support is derived from the same provider-owned name resolver used to translate
portable tool names into request payloads. Custom providers that omit the
resolver preserve provider-tool passthrough behavior. Resolution does not mutate
or clone the caller's `ToolRegistry`; fallback execution delegates to the original
registry through a run-scoped resolved tool set.
