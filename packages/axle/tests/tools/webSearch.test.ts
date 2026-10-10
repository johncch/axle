import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import type { AnyStreamChunk } from "../../src/messages/stream.js";
import { stream } from "../../src/providers/stream.js";
import type { AIProvider } from "../../src/providers/types.js";
import { AxleStopReason } from "../../src/providers/types.js";
import type { ExecutableTool } from "../../src/tools/types.js";
import { braveWebSearch } from "../../src/tools/webSearch.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("provider-brought web search", () => {
  test("the loop runs a web_search call against the tool the provider brings", async () => {
    const webSearch = makeWebSearchTool();
    const provider = makeProvider({ tools: [webSearch] });

    const result = await stream({
      provider,
      model: "test-model",
      messages: [{ role: "user", content: "Search the web." }],
      providerTools: [{ type: "provider", name: "web_search" }],
    }).final;

    expect(result.ok).toBe(true);
    expect(provider.requests[0].providerTools).toEqual([{ type: "provider", name: "web_search" }]);
    expect(webSearch.execute).toHaveBeenCalledWith(
      { query: "current axle release" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const toolMessage = result.messages.find((message) => message.role === "tool");
    expect(JSON.stringify(toolMessage)).toContain("https://example.com/axle");
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
    const webSearch = braveWebSearch({
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

    const result = await webSearch.execute({ query: "axle ai" }, { signal, emit: () => {} });

    expect(JSON.parse(String(result))).toEqual({
      query: "axle ai",
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
    const webSearch = braveWebSearch({ apiKey: "brave-secret" });

    await expect(
      webSearch.execute(
        { query: "axle ai" },
        { signal: new AbortController().signal, emit: () => {} },
      ),
    ).rejects.toThrow("Brave Search request failed with status 429: rate limited for [REDACTED]");
    await expect(
      webSearch.execute(
        { query: "axle ai" },
        { signal: new AbortController().signal, emit: () => {} },
      ),
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

function makeWebSearchTool(): ExecutableTool & { execute: ReturnType<typeof vi.fn> } {
  return {
    name: "web_search",
    description: "Search the web.",
    schema: z.object({ query: z.string() }),
    execute: vi
      .fn()
      .mockResolvedValue(
        JSON.stringify({ results: [{ title: "Axle", url: "https://example.com/axle" }] }),
      ),
  };
}

function makeProvider(options: { tools: ExecutableTool[] }): AIProvider & {
  requests: Array<{ tools?: unknown[]; providerTools?: unknown[] }>;
} {
  let callCount = 0;
  const requests: Array<{ tools?: unknown[]; providerTools?: unknown[] }> = [];
  return {
    name: "test-provider",
    requests,
    tools: options.tools,
    async *createStreamingRequest(model, params): AsyncGenerator<AnyStreamChunk, void, unknown> {
      callCount += 1;
      requests.push({
        tools: params.tools,
        providerTools: params.providerTools,
      });
      yield { type: "start", id: `turn-${callCount}`, data: { model, timestamp: Date.now() } };

      if (callCount === 1) {
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
