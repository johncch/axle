import { afterEach, describe, expect, test, vi } from "vitest";

const HEADERS = { "X-App-Name": "axle-test", "X-App-Version": "1.2.3" };

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

    const { openai } = await import("../../src/providers/openai.js");
    const provider = openai("sk-test", { maxRetries: 4, timeoutMs: 1_000 });

    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: "sk-test",
      baseURL: "https://api.openai.com/v1",
      maxRetries: 4,
      timeout: 1_000,
    });
  });

  test("passes client headers to the OpenAI SDK", async () => {
    const OpenAI = vi.fn();
    vi.doMock("openai", () => ({ default: OpenAI }));

    const { openai } = await import("../../src/providers/openai.js");
    openai("sk-test", { headers: HEADERS });

    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: "sk-test",
      baseURL: "https://api.openai.com/v1",
      maxRetries: 2,
      defaultHeaders: HEADERS,
    });
  });

  test("passes a custom fetch to the OpenAI SDK", async () => {
    const OpenAI = vi.fn();
    vi.doMock("openai", () => ({ default: OpenAI }));
    const customFetch = vi.fn<typeof fetch>();

    const { openai } = await import("../../src/providers/openai.js");
    openai("sk-test", { fetch: customFetch });

    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: "sk-test",
      baseURL: "https://api.openai.com/v1",
      maxRetries: 2,
      fetch: customFetch,
    });
  });

  test("bedrock() sends messages to the runtime hostname", async () => {
    const Anthropic = vi.fn();
    vi.doMock("@anthropic-ai/sdk", () => ({ default: Anthropic }));

    const { bedrock } = await import("../../src/providers/bedrock.js");
    const provider = bedrock("key", { protocol: "messages", region: "us-east-1", maxRetries: 4 });

    expect(provider).toMatchObject({ protocol: "messages", id: "amazon-bedrock" });
    expect(Anthropic).toHaveBeenCalledWith({
      apiKey: "key",
      baseURL: "https://bedrock-runtime.us-east-1.amazonaws.com/anthropic",
      maxRetries: 4,
    });
  });

  test("bedrock() sends responses to the Mantle hostname", async () => {
    const OpenAI = vi.fn();
    vi.doMock("openai", () => ({ default: OpenAI }));

    const { bedrock } = await import("../../src/providers/bedrock.js");
    const provider = bedrock("key", { protocol: "responses", region: "eu-west-1" });

    expect(provider).toMatchObject({ protocol: "responses", id: "amazon-bedrock" });
    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: "key",
      baseURL: "https://bedrock-mantle.eu-west-1.api.aws/v1",
      maxRetries: 2,
    });
  });

  test("bedrock() sends chat completions to the Mantle hostname", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("", { status: 500 }));

    const { bedrock } = await import("../../src/providers/bedrock.js");
    const provider = bedrock("key", {
      protocol: "chatCompletions",
      region: "us-west-2",
      fetch: fetchMock,
      maxRetries: 0,
    });
    expect(provider).toMatchObject({ protocol: "chatCompletions", id: "amazon-bedrock" });

    for await (const _chunk of provider.createStreamingRequest("openai.gpt-oss-20b", {
      messages: [{ role: "user", content: "Hi" }],
      runtime: {},
    })) {
      // drain
    }

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://bedrock-mantle.us-west-2.api.aws/v1/chat/completions",
    );
  });

  test("responses() passes its base URL to the OpenAI SDK", async () => {
    const OpenAI = vi.fn();
    vi.doMock("openai", () => ({ default: OpenAI }));

    const { responses } = await import("../../src/protocols/responses/responses.js");
    responses({ baseUrl: "https://gateway.example.test/openai/v1", apiKey: "sk-test" });

    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: "sk-test",
      baseURL: "https://gateway.example.test/openai/v1",
      maxRetries: 2,
    });
  });

  test("rejects invalid OpenAI client options", async () => {
    const OpenAI = vi.fn();
    vi.doMock("openai", () => ({ default: OpenAI }));

    const { openai } = await import("../../src/providers/openai.js");

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

    const { anthropic } = await import("../../src/providers/anthropic.js");
    const provider = anthropic("sk-ant-test", { maxRetries: 4, timeoutMs: 1_000 });

    expect(Anthropic).toHaveBeenCalledWith({
      apiKey: "sk-ant-test",
      baseURL: "https://api.anthropic.com",
      maxRetries: 4,
      timeout: 1_000,
    });
  });

  test("passes client headers to the Anthropic SDK", async () => {
    const Anthropic = vi.fn();
    vi.doMock("@anthropic-ai/sdk", () => ({ default: Anthropic }));

    const { anthropic } = await import("../../src/providers/anthropic.js");
    anthropic("sk-ant-test", { headers: HEADERS });

    expect(Anthropic).toHaveBeenCalledWith({
      apiKey: "sk-ant-test",
      baseURL: "https://api.anthropic.com",
      maxRetries: 2,
      defaultHeaders: HEADERS,
    });
  });

  test("passes a custom fetch to the Anthropic SDK", async () => {
    const Anthropic = vi.fn();
    vi.doMock("@anthropic-ai/sdk", () => ({ default: Anthropic }));
    const customFetch = vi.fn<typeof fetch>();

    const { anthropic } = await import("../../src/providers/anthropic.js");
    anthropic("sk-ant-test", { fetch: customFetch });

    expect(Anthropic).toHaveBeenCalledWith({
      apiKey: "sk-ant-test",
      baseURL: "https://api.anthropic.com",
      maxRetries: 2,
      fetch: customFetch,
    });
  });

  test("messages() passes its base URL to the Anthropic SDK", async () => {
    const Anthropic = vi.fn();
    vi.doMock("@anthropic-ai/sdk", () => ({ default: Anthropic }));

    const { messages } = await import("../../src/protocols/messages/messages.js");
    messages({ baseUrl: "https://gateway.example.test/anthropic", apiKey: "sk-ant-test" });

    expect(Anthropic).toHaveBeenCalledWith({
      apiKey: "sk-ant-test",
      baseURL: "https://gateway.example.test/anthropic",
      maxRetries: 2,
    });
  });

  test("rejects invalid Anthropic client options", async () => {
    const Anthropic = vi.fn();
    vi.doMock("@anthropic-ai/sdk", () => ({ default: Anthropic }));

    const { anthropic } = await import("../../src/providers/anthropic.js");

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

    const { gemini } = await import("../../src/providers/gemini.js");
    const provider = gemini("gemini-test", { maxRetries: 4, timeoutMs: 1_000 });

    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: "gemini-test",
      httpOptions: {
        baseUrl: "https://generativelanguage.googleapis.com",
        retryOptions: { attempts: 5 },
        timeout: 1_000,
      },
    });
  });

  test("passes client headers to Gemini HTTP options", async () => {
    const GoogleGenAI = vi.fn();
    vi.doMock("@google/genai", () => ({ GoogleGenAI }));

    const { gemini } = await import("../../src/providers/gemini.js");
    gemini("gemini-test", { headers: HEADERS });

    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: "gemini-test",
      httpOptions: {
        baseUrl: "https://generativelanguage.googleapis.com",
        retryOptions: { attempts: 3 },
        headers: HEADERS,
      },
    });
  });

  test("passes a custom fetch to Gemini HTTP options", async () => {
    const GoogleGenAI = vi.fn();
    vi.doMock("@google/genai", () => ({ GoogleGenAI }));
    const customFetch = vi.fn<typeof fetch>();

    const { gemini } = await import("../../src/providers/gemini.js");
    gemini("gemini-test", { fetch: customFetch });

    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: "gemini-test",
      httpOptions: {
        baseUrl: "https://generativelanguage.googleapis.com",
        retryOptions: { attempts: 3 },
        fetch: customFetch,
      },
    });
  });

  test("generateContent() passes its base URL to Gemini HTTP options", async () => {
    const GoogleGenAI = vi.fn();
    vi.doMock("@google/genai", () => ({ GoogleGenAI }));

    const { generateContent } =
      await import("../../src/protocols/generateContent/generateContent.js");
    generateContent({ baseUrl: "https://gateway.example.test/gemini", apiKey: "gemini-test" });

    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: "gemini-test",
      httpOptions: {
        baseUrl: "https://gateway.example.test/gemini",
        retryOptions: { attempts: 3 },
      },
    });
  });

  test("rejects invalid Gemini client options", async () => {
    const GoogleGenAI = vi.fn();
    vi.doMock("@google/genai", () => ({ GoogleGenAI }));

    const { gemini } = await import("../../src/providers/gemini.js");

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
    const { chatCompletions } =
      await import("../../src/protocols/chatCompletions/chatCompletions.js");

    expect(() => chatCompletions({ baseUrl: "http://example.test", maxRetries: -1 })).toThrow(
      "maxRetries must be an integer greater than or equal to 0",
    );
    expect(() => chatCompletions({ baseUrl: "http://example.test", maxRetries: 1.5 })).toThrow(
      "maxRetries must be an integer",
    );
    expect(() => chatCompletions({ baseUrl: "http://example.test", timeoutMs: 0 })).toThrow(
      "timeoutMs must be an integer greater than or equal to 1",
    );
    expect(() => chatCompletions({ baseUrl: "http://example.test", timeoutMs: 1.5 })).toThrow(
      "timeoutMs must be an integer",
    );
  });

  test("each preset declares its protocol and provider id", async () => {
    const { anthropic } = await import("../../src/providers/anthropic.js");
    const { openai } = await import("../../src/providers/openai.js");
    const { gemini } = await import("../../src/providers/gemini.js");
    const { openrouter } = await import("../../src/providers/openrouter.js");
    const { together } = await import("../../src/providers/together.js");

    expect(anthropic("k")).toMatchObject({ protocol: "messages", id: "anthropic" });
    expect(openai("k")).toMatchObject({ protocol: "responses", id: "openai" });
    expect(gemini("k")).toMatchObject({ protocol: "generateContent", id: "google" });
    expect(openrouter("k")).toMatchObject({ protocol: "chatCompletions", id: "openrouter" });
    expect(together("k")).toMatchObject({ protocol: "chatCompletions", id: "togetherai" });
  });

  test("infers the provider id from a known hostname, exactly", async () => {
    const { chatCompletions } =
      await import("../../src/protocols/chatCompletions/chatCompletions.js");
    const { messages } = await import("../../src/protocols/messages/messages.js");
    const { responses } = await import("../../src/protocols/responses/responses.js");
    const { generateContent } =
      await import("../../src/protocols/generateContent/generateContent.js");

    expect(chatCompletions({ baseUrl: "https://openrouter.ai/api/v1", apiKey: "k" }).id).toBe(
      "openrouter",
    );
    expect(chatCompletions({ baseUrl: "https://api.together.xyz/v1", apiKey: "k" }).id).toBe(
      "togetherai",
    );
    expect(messages({ baseUrl: "https://api.anthropic.com", apiKey: "k" }).id).toBe("anthropic");
    expect(responses({ baseUrl: "https://api.openai.com/v1", apiKey: "k" }).id).toBe("openai");
    expect(
      generateContent({ baseUrl: "https://generativelanguage.googleapis.com", apiKey: "k" }).id,
    ).toBe("google");
    expect(
      chatCompletions({ baseUrl: "https://openrouter.example.test/v1", apiKey: "k" }).id,
    ).toBeUndefined();
    expect(
      chatCompletions({ baseUrl: "http://localhost:11434/v1", apiKey: "k" }).id,
    ).toBeUndefined();
    expect(
      messages({ baseUrl: "https://gateway.example.test/anthropic", apiKey: "k" }).id,
    ).toBeUndefined();
  });

  test("infers the provider from a subdomain of a known hostname", async () => {
    const { chatCompletions } =
      await import("../../src/protocols/chatCompletions/chatCompletions.js");

    expect(chatCompletions({ baseUrl: "https://eu.openrouter.ai/api/v1", apiKey: "k" }).id).toBe(
      "openrouter",
    );
    expect(chatCompletions({ baseUrl: "https://api.openrouter.ai/v1", apiKey: "k" }).id).toBe(
      "openrouter",
    );
    expect(
      chatCompletions({ baseUrl: "https://notopenrouter.ai/api/v1", apiKey: "k" }).id,
    ).toBeUndefined();
    expect(
      chatCompletions({ baseUrl: "https://openrouter.ai.example.test/v1", apiKey: "k" }).id,
    ).toBeUndefined();
  });

  test("openrouter() takes a base URL for a regional host", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("", { status: 500 }));

    const { openrouter } = await import("../../src/providers/openrouter.js");
    const provider = openrouter("k", {
      baseUrl: "https://eu.openrouter.ai/api/v1",
      fetch: fetchMock,
      maxRetries: 0,
    });
    expect(provider).toMatchObject({ protocol: "chatCompletions", id: "openrouter" });

    for await (const _chunk of provider.createStreamingRequest("deepseek/deepseek-chat", {
      messages: [{ role: "user", content: "Hi" }],
      runtime: {},
    })) {
      // drain
    }

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://eu.openrouter.ai/api/v1/chat/completions");
  });

  test("an explicit id wins over the hostname", async () => {
    const { chatCompletions } =
      await import("../../src/protocols/chatCompletions/chatCompletions.js");

    expect(chatCompletions({ baseUrl: "https://openrouter.ai/api/v1", id: "acme" }).id).toBe(
      "acme",
    );
    expect(chatCompletions({ baseUrl: "http://localhost:11434/v1", id: "openrouter" }).id).toBe(
      "openrouter",
    );
  });

  test("sends the model id through resolveModel, and unchanged without one", async () => {
    const okStream = () =>
      new Response(
        [
          `data: ${JSON.stringify({
            id: "chatcmpl-1",
            model: "m",
            choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          })}`,
          "",
          "data: [DONE]",
          "",
        ].join("\n"),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => okStream());
    vi.stubGlobal("fetch", fetchMock);
    const { chatCompletions } =
      await import("../../src/protocols/chatCompletions/chatCompletions.js");
    const sentModel = async (provider: ReturnType<typeof chatCompletions>, model: string) => {
      for await (const _chunk of provider.createStreamingRequest(model, {
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
      })) {
        // drain
      }
      return JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body)).model;
    };

    const local = "http://localhost:11434/v1";
    expect(
      await sentModel(
        chatCompletions({
          baseUrl: local,
          resolveModel: (model) => model.replace(/^ollama\//, ""),
        }),
        "ollama/gemma3",
      ),
    ).toBe("gemma3");
    expect(await sentModel(chatCompletions({ baseUrl: local }), "ollama/gemma3")).toBe(
      "ollama/gemma3",
    );
  });

  test("detects Together from its official endpoint hostname", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            `data: ${JSON.stringify({
              id: "chatcmpl-1",
              model: "test-model",
              choices: [
                { index: 0, delta: { role: "assistant", content: "Hi" }, finish_reason: "stop" },
              ],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            })}`,
            "",
            "data: [DONE]",
            "",
          ].join("\n"),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      ),
    );

    const { chatCompletions } =
      await import("../../src/protocols/chatCompletions/chatCompletions.js");
    const together = chatCompletions({ baseUrl: "https://api.together.ai/v1" });

    for await (const _chunk of together.createStreamingRequest("test-model", {
      messages: [{ role: "user", content: "Hi" }],
      runtime: {},
      reasoning: "off",
    })) {
      // drain
    }

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body.reasoning_effort).toBeUndefined();
  });
});
