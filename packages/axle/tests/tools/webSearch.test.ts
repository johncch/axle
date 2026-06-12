import { afterEach, describe, expect, test, vi } from "vitest";
import { configureAxle } from "../../src/config.js";
import type { AnyStreamChunk } from "../../src/messages/stream.js";
import { stream } from "../../src/providers/stream.js";
import type { AIProvider } from "../../src/providers/types.js";
import { AxleStopReason } from "../../src/providers/types.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { braveWebSearch, type WebSearchBackend } from "../../src/tools/webSearch.js";

afterEach(() => {
  configureAxle({ webSearchFallback: undefined });
  vi.restoreAllMocks();
});

describe("web search fallback resolution", () => {
  test("uses native provider search when available", async () => {
    const backend = makeBackend();
    configureAxle({ webSearchFallback: backend });
    const provider = makeProvider({ nativeWebSearch: true });

    const result = await stream({
      provider,
      model: "native-model",
      messages: [{ role: "user", content: "Search the web." }],
      providerTools: [{ type: "provider", name: "web_search" }],
    }).final;

    expect(result.ok).toBe(true);
    expect(provider.requests[0].providerTools).toEqual([
      {
        type: "provider",
        name: "web_search",
        nativeName: "native:web_search",
      },
    ]);
    expect(provider.requests[0].tools).toBeUndefined();
    expect(backend.search).not.toHaveBeenCalled();
  });

  test("replaces unsupported native search with the configured fallback", async () => {
    const backend = makeBackend();
    configureAxle({ webSearchFallback: backend });
    const provider = makeProvider({ nativeWebSearch: false, callFallbackTool: true });
    const registry = new ToolRegistry({
      providerTools: [{ type: "provider", name: "web_search" }],
    });
    let executionRegistry: ToolRegistry | undefined;

    const result = await stream({
      provider,
      model: "fallback-model",
      messages: [{ role: "user", content: "Search the web." }],
      registry,
      onToolCall: async (_name, _parameters, ctx) => {
        executionRegistry = ctx.registry;
        return null;
      },
    }).final;

    expect(result.ok).toBe(true);
    expect(executionRegistry).toBe(registry);
    expect(registry.getProvider("web_search")).toEqual({
      type: "provider",
      name: "web_search",
    });
    expect(registry.get("web_search")).toBeUndefined();
    expect(provider.requests[0].providerTools).toBeUndefined();
    expect(provider.requests[0].tools).toEqual([expect.objectContaining({ name: "web_search" })]);
    expect(backend.search).toHaveBeenCalledWith(
      { query: "current axle release" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const toolMessage = result.messages.find((message) => message.role === "tool");
    expect(JSON.stringify(toolMessage)).toContain("https://example.com/axle");
  });

  test("fails before the provider request when no fallback is configured", async () => {
    const provider = makeProvider({ nativeWebSearch: false });

    const handle = stream({
      provider,
      model: "fallback-model",
      messages: [{ role: "user", content: "Search the web." }],
      providerTools: [{ type: "provider", name: "web_search" }],
    });

    await expect(handle.final).rejects.toMatchObject({
      code: "WEB_SEARCH_FALLBACK_NOT_CONFIGURED",
    });
    expect(provider.requests).toHaveLength(0);
  });

  test("preserves passthrough behavior for custom providers without support metadata", async () => {
    const backend = makeBackend();
    configureAxle({ webSearchFallback: backend });
    const provider = makeProvider({});

    const result = await stream({
      provider,
      model: "custom-model",
      messages: [{ role: "user", content: "Search the web." }],
      providerTools: [{ type: "provider", name: "web_search" }],
    }).final;

    expect(result.ok).toBe(true);
    expect(provider.requests[0].providerTools).toEqual([{ type: "provider", name: "web_search" }]);
    expect(backend.search).not.toHaveBeenCalled();
  });

  test("snapshots the fallback backend when the run starts", async () => {
    const first = makeBackend("first");
    const second = makeBackend("second");
    configureAxle({ webSearchFallback: first });
    const provider = makeProvider({ nativeWebSearch: false, callFallbackTool: true });

    const handle = stream({
      provider,
      model: "fallback-model",
      messages: [{ role: "user", content: "Search the web." }],
      providerTools: [{ type: "provider", name: "web_search" }],
    });
    configureAxle({ webSearchFallback: second });

    const result = await handle.final;

    expect(result.ok).toBe(true);
    expect(first.search).toHaveBeenCalledOnce();
    expect(second.search).not.toHaveBeenCalled();
  });
});

describe("braveWebSearch", () => {
  test("builds a Brave LLM Context request and normalizes grounding results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          grounding: {
            generic: [
              {
                title: "Axle",
                url: "https://example.com/axle",
                snippets: ["Axle documentation", "Native-first web search fallback"],
              },
              { title: "Missing URL" },
            ],
            poi: {
              title: "Axle Office",
              url: "https://example.com/office",
              snippets: ["Office details"],
            },
          },
        }),
      }),
    );
    const backend = braveWebSearch({
      apiKey: "brave-secret",
      maxResults: 7,
      candidateCount: 20,
      maxTokens: 6_000,
      maxSnippets: 30,
      maxTokensPerUrl: 2_000,
      maxSnippetsPerUrl: 5,
      contextThresholdMode: "balanced",
      country: "US",
      searchLanguage: "en",
      freshness: "pw",
    });
    const signal = new AbortController().signal;

    const result = await backend.search({ query: "axle ai" }, { signal });

    expect(result).toEqual({
      results: [
        {
          title: "Axle",
          url: "https://example.com/axle",
          snippets: ["Axle documentation", "Native-first web search fallback"],
        },
        {
          title: "Axle Office",
          url: "https://example.com/office",
          snippets: ["Office details"],
        },
      ],
    });
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBeInstanceOf(URL);
    expect(url.pathname).toBe("/res/v1/llm/context");
    expect(url.searchParams.get("q")).toBe("axle ai");
    expect(url.searchParams.get("maximum_number_of_urls")).toBe("7");
    expect(url.searchParams.get("count")).toBe("20");
    expect(url.searchParams.get("maximum_number_of_tokens")).toBe("6000");
    expect(url.searchParams.get("maximum_number_of_snippets")).toBe("30");
    expect(url.searchParams.get("maximum_number_of_tokens_per_url")).toBe("2000");
    expect(url.searchParams.get("maximum_number_of_snippets_per_url")).toBe("5");
    expect(url.searchParams.get("context_threshold_mode")).toBe("balanced");
    expect(url.searchParams.get("country")).toBe("US");
    expect(url.searchParams.get("search_lang")).toBe("en");
    expect(url.searchParams.get("freshness")).toBe("pw");
    expect(url.toString()).not.toContain("brave-secret");
    expect(init.headers["X-Subscription-Token"]).toBe("brave-secret");
    expect(init.signal).toBe(signal);
  });

  test("surfaces Brave HTTP failures without exposing the API key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "rate limited for brave-secret",
      }),
    );
    const backend = braveWebSearch({ apiKey: "brave-secret" });

    await expect(
      backend.search({ query: "axle ai" }, { signal: new AbortController().signal }),
    ).rejects.toThrow("Brave Search request failed with status 429: rate limited for [REDACTED]");
    await expect(
      backend.search({ query: "axle ai" }, { signal: new AbortController().signal }),
    ).rejects.not.toThrow("brave-secret");
    const [url] = (fetch as any).mock.calls[0];
    expect(url.searchParams.get("maximum_number_of_urls")).toBe("5");
    expect(url.searchParams.get("maximum_number_of_tokens")).toBe("4096");
  });

  test("validates required and bounded options", () => {
    expect(() => braveWebSearch({ apiKey: "" })).toThrow("apiKey is required");
    expect(() => braveWebSearch({ apiKey: "key", maxResults: 0 })).toThrow(
      "maxResults must be greater than or equal to 1",
    );
    expect(() => braveWebSearch({ apiKey: "key", maxResults: 51 })).toThrow(
      "maxResults must be less than or equal to 50",
    );
    expect(() => braveWebSearch({ apiKey: "key", candidateCount: 51 })).toThrow(
      "candidateCount must be less than or equal to 50",
    );
    expect(() => braveWebSearch({ apiKey: "key", maxTokens: 32_769 })).toThrow(
      "maxTokens must be less than or equal to 32768",
    );
    expect(() => braveWebSearch({ apiKey: "key", maxSnippets: 257 })).toThrow(
      "maxSnippets must be less than or equal to 256",
    );
    expect(() => braveWebSearch({ apiKey: "key", maxTokensPerUrl: 8_193 })).toThrow(
      "maxTokensPerUrl must be less than or equal to 8192",
    );
    expect(() => braveWebSearch({ apiKey: "key", maxSnippetsPerUrl: 101 })).toThrow(
      "maxSnippetsPerUrl must be less than or equal to 100",
    );
  });
});

function makeBackend(name = "test"): WebSearchBackend & { search: ReturnType<typeof vi.fn> } {
  return {
    name,
    search: vi.fn().mockResolvedValue({
      results: [
        {
          title: "Axle",
          url: "https://example.com/axle",
          snippets: ["Axle documentation"],
        },
      ],
    }),
  };
}

function makeProvider(options: {
  nativeWebSearch?: boolean;
  callFallbackTool?: boolean;
}): AIProvider & {
  requests: Array<{ tools?: unknown[]; providerTools?: unknown[] }>;
} {
  let callCount = 0;
  const requests: Array<{ tools?: unknown[]; providerTools?: unknown[] }> = [];
  return {
    name: "test-provider",
    requests,
    ...(options.nativeWebSearch === undefined
      ? {}
      : {
          resolveProviderToolName(name: string) {
            return name === "web_search" && options.nativeWebSearch === true
              ? "native:web_search"
              : undefined;
          },
        }),
    async createGenerationRequest() {
      throw new Error("not used");
    },
    async *createStreamingRequest(model, params): AsyncGenerator<AnyStreamChunk, void, unknown> {
      callCount += 1;
      requests.push({
        tools: params.tools,
        providerTools: params.providerTools,
      });
      yield { type: "start", id: `turn-${callCount}`, data: { model, timestamp: Date.now() } };

      if (callCount === 1 && options.callFallbackTool) {
        yield {
          type: "tool-call-start",
          data: { index: 0, id: "search-1", name: "web_search" },
        };
        yield {
          type: "tool-call-complete",
          data: {
            index: 0,
            id: "search-1",
            name: "web_search",
            arguments: { query: "current axle release" },
          },
        };
        yield {
          type: "complete",
          data: { finishReason: AxleStopReason.FunctionCall, usage: { in: 1, out: 1 } },
        };
        return;
      }

      yield { type: "text-start", data: { index: 0 } };
      yield { type: "text-delta", data: { index: 0, text: "done" } };
      yield { type: "text-complete", data: { index: 0 } };
      yield {
        type: "complete",
        data: { finishReason: AxleStopReason.Stop, usage: { in: 1, out: 1 } },
      };
    },
  };
}
