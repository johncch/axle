import { afterEach, describe, expect, test, vi } from "vitest";

describe("provider client factory options", () => {
  afterEach(() => {
    vi.doUnmock("openai");
    vi.doUnmock("@anthropic-ai/sdk");
    vi.doUnmock("@google/genai");
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  test("passes client options to the OpenAI SDK", async () => {
    const OpenAI = vi.fn();
    vi.doMock("openai", () => ({ default: OpenAI }));

    const { openai } = await import("../../src/providers/openai/provider.js");
    const provider = openai("sk-test", { maxRetries: 4, timeoutMs: 1_000 });

    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: "sk-test",
      maxRetries: 4,
      timeout: 1_000,
    });
    expect(provider.resolveProviderToolName?.("web_search", "gpt-test")).toBe("web_search_preview");
  });

  test("rejects invalid OpenAI client options", async () => {
    const OpenAI = vi.fn();
    vi.doMock("openai", () => ({ default: OpenAI }));

    const { openai } = await import("../../src/providers/openai/provider.js");

    expect(() => openai("sk-test", { maxRetries: -1 })).toThrow(
      "maxRetries must be an integer greater than or equal to 0",
    );
    expect(() => openai("sk-test", { maxRetries: 1.5 })).toThrow("maxRetries must be an integer");
    expect(() => openai("sk-test", { timeoutMs: 0 })).toThrow(
      "timeoutMs must be an integer greater than or equal to 1",
    );
    expect(() => openai("sk-test", { timeoutMs: 1.5 })).toThrow("timeoutMs must be an integer");
  });

  test("passes client options to the Anthropic SDK", async () => {
    const Anthropic = vi.fn();
    vi.doMock("@anthropic-ai/sdk", () => ({ default: Anthropic }));

    const { anthropic } = await import("../../src/providers/anthropic/provider.js");
    const provider = anthropic("sk-ant-test", { maxRetries: 4, timeoutMs: 1_000 });

    expect(Anthropic).toHaveBeenCalledWith({
      apiKey: "sk-ant-test",
      maxRetries: 4,
      timeout: 1_000,
    });
    expect(provider.resolveProviderToolName?.("web_search", "claude-test")).toBe(
      "web_search_20250305",
    );
  });

  test("rejects invalid Anthropic client options", async () => {
    const Anthropic = vi.fn();
    vi.doMock("@anthropic-ai/sdk", () => ({ default: Anthropic }));

    const { anthropic } = await import("../../src/providers/anthropic/provider.js");

    expect(() => anthropic("sk-ant-test", { maxRetries: -1 })).toThrow(
      "maxRetries must be an integer greater than or equal to 0",
    );
    expect(() => anthropic("sk-ant-test", { maxRetries: 1.5 })).toThrow(
      "maxRetries must be an integer",
    );
    expect(() => anthropic("sk-ant-test", { timeoutMs: 0 })).toThrow(
      "timeoutMs must be an integer greater than or equal to 1",
    );
    expect(() => anthropic("sk-ant-test", { timeoutMs: 1.5 })).toThrow(
      "timeoutMs must be an integer",
    );
  });

  test("maps client options to Gemini HTTP options", async () => {
    const GoogleGenAI = vi.fn();
    vi.doMock("@google/genai", () => ({ GoogleGenAI }));

    const { gemini } = await import("../../src/providers/gemini/provider.js");
    const provider = gemini("gemini-test", { maxRetries: 4, timeoutMs: 1_000 });

    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: "gemini-test",
      httpOptions: { retryOptions: { attempts: 5 }, timeout: 1_000 },
    });
    expect(provider.resolveProviderToolName?.("web_search", "gemini-test")).toBe("googleSearch");
  });

  test("rejects invalid Gemini client options", async () => {
    const GoogleGenAI = vi.fn();
    vi.doMock("@google/genai", () => ({ GoogleGenAI }));

    const { gemini } = await import("../../src/providers/gemini/provider.js");

    expect(() => gemini("gemini-test", { maxRetries: -1 })).toThrow(
      "maxRetries must be an integer greater than or equal to 0",
    );
    expect(() => gemini("gemini-test", { maxRetries: 1.5 })).toThrow(
      "maxRetries must be an integer",
    );
    expect(() => gemini("gemini-test", { timeoutMs: 0 })).toThrow(
      "timeoutMs must be an integer greater than or equal to 1",
    );
    expect(() => gemini("gemini-test", { timeoutMs: 1.5 })).toThrow("timeoutMs must be an integer");
  });

  test("rejects invalid ChatCompletions client options", async () => {
    const { chatCompletions } = await import("../../src/providers/chatcompletions/provider.js");

    expect(() => chatCompletions("http://example.test", { maxRetries: -1 })).toThrow(
      "maxRetries must be an integer greater than or equal to 0",
    );
    expect(() => chatCompletions("http://example.test", { maxRetries: 1.5 })).toThrow(
      "maxRetries must be an integer",
    );
    expect(() => chatCompletions("http://example.test", { timeoutMs: 0 })).toThrow(
      "timeoutMs must be an integer greater than or equal to 1",
    );
    expect(() => chatCompletions("http://example.test", { timeoutMs: 1.5 })).toThrow(
      "timeoutMs must be an integer",
    );
  });

  test("detects ChatCompletions vendors from official endpoint hostnames", async () => {
    const { chatCompletions } = await import("../../src/providers/chatcompletions/provider.js");

    const generic = chatCompletions("http://example.test");
    const similarHostname = chatCompletions("https://openrouter.example.test/v1");
    const inferredOpenRouter = chatCompletions("https://openrouter.ai/api/v1");
    const explicitOpenRouter = chatCompletions("http://gateway.example.test", {
      vendor: "openrouter",
    });

    expect(generic.resolveProviderToolName?.("web_search", "test-model")).toBeUndefined();
    expect(similarHostname.resolveProviderToolName?.("web_search", "test-model")).toBeUndefined();
    expect(inferredOpenRouter.resolveProviderToolName?.("web_search", "test-model")).toBe(
      "openrouter:web_search",
    );
    expect(explicitOpenRouter.resolveProviderToolName?.("web_search", "test-model")).toBe(
      "openrouter:web_search",
    );
  });

  test("detects Together from its official endpoint hostname", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "chatcmpl-1",
            model: "test-model",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Hi" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const { chatCompletions } = await import("../../src/providers/chatcompletions/provider.js");
    const together = chatCompletions("https://api.together.ai/v1");

    await together.createGenerationRequest("test-model", {
      messages: [{ role: "user", content: "Hi" }],
      runtime: {},
      reasoning: false,
    });

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body.reasoning_effort).toBeUndefined();
  });
});
