import { afterEach, describe, expect, test, vi } from "vitest";

describe("provider client factory options", () => {
  afterEach(() => {
    vi.doUnmock("openai");
    vi.doUnmock("@anthropic-ai/sdk");
    vi.doUnmock("@google/genai");
    vi.resetModules();
  });

  test("passes client options to the OpenAI SDK", async () => {
    const OpenAI = vi.fn();
    vi.doMock("openai", () => ({ default: OpenAI }));

    const { openai } = await import("../../src/providers/openai/provider.js");
    openai("sk-test", { maxRetries: 4, timeoutMs: 1_000 });

    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: "sk-test",
      maxRetries: 4,
      timeout: 1_000,
    });
  });

  test("rejects invalid OpenAI client options", async () => {
    const OpenAI = vi.fn();
    vi.doMock("openai", () => ({ default: OpenAI }));

    const { openai } = await import("../../src/providers/openai/provider.js");

    expect(() => openai("sk-test", { maxRetries: -1 })).toThrow(
      "maxRetries must be an integer greater than or equal to 0",
    );
    expect(() => openai("sk-test", { maxRetries: 1.5 })).toThrow(
      "maxRetries must be an integer",
    );
    expect(() => openai("sk-test", { timeoutMs: 0 })).toThrow(
      "timeoutMs must be an integer greater than or equal to 1",
    );
    expect(() => openai("sk-test", { timeoutMs: 1.5 })).toThrow(
      "timeoutMs must be an integer",
    );
  });

  test("passes client options to the Anthropic SDK", async () => {
    const Anthropic = vi.fn();
    vi.doMock("@anthropic-ai/sdk", () => ({ default: Anthropic }));

    const { anthropic } = await import("../../src/providers/anthropic/provider.js");
    anthropic("sk-ant-test", { maxRetries: 4, timeoutMs: 1_000 });

    expect(Anthropic).toHaveBeenCalledWith({
      apiKey: "sk-ant-test",
      maxRetries: 4,
      timeout: 1_000,
    });
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
    gemini("gemini-test", { maxRetries: 4, timeoutMs: 1_000 });

    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: "gemini-test",
      httpOptions: { retryOptions: { attempts: 5 }, timeout: 1_000 },
    });
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
    expect(() => gemini("gemini-test", { timeoutMs: 1.5 })).toThrow(
      "timeoutMs must be an integer",
    );
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
});
