import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { AxleAbortError } from "../../../src/errors/AxleAbortError.js";
import { createGenerationRequest } from "../../../src/providers/chatcompletions/createGenerationRequest.js";
import type { ChatCompletionResponse } from "../../../src/providers/chatcompletions/types.js";
import { AxleStopReason } from "../../../src/providers/types.js";

const BASE_URL = "http://localhost:11434/v1";
const MODEL = "gemma3";

describe("createGenerationRequest", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("abort handling", () => {
    test("throws AxleAbortError before calling fetch when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort("pre-aborted");

      await expect(
        createGenerationRequest({
          baseUrl: BASE_URL,
          model: MODEL,
          messages: [{ role: "user", content: "Hi" }],
          runtime: {},
          signal: controller.signal,
        }),
      ).rejects.toBeInstanceOf(AxleAbortError);

      expect(fetch).not.toHaveBeenCalled();
    });

    test("passes signal to fetch", async () => {
      const controller = new AbortController();
      (fetch as any).mockResolvedValue(makeOkResponse(makeTextResponse("Hi")));

      await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
        signal: controller.signal,
      });

      expect((fetch as any).mock.calls[0][1].signal).toBe(controller.signal);
    });

    test("throws AxleAbortError when aborted during a pending fetch", async () => {
      const controller = new AbortController();
      (fetch as any).mockImplementation(() => new Promise(() => {}));

      const pending = createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
        signal: controller.signal,
      });

      const reason = { type: "timeout" };
      controller.abort(reason);

      await expect(pending).rejects.toMatchObject({
        name: "AbortError",
        reason,
      });
    });
  });

  describe("request construction", () => {
    test("sends POST to {baseUrl}/chat/completions", async () => {
      const mockResponse = makeTextResponse("Hello");
      (fetch as any).mockResolvedValue(makeOkResponse(mockResponse));

      await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
      });

      expect(fetch).toHaveBeenCalledWith(
        `${BASE_URL}/chat/completions`,
        expect.objectContaining({ method: "POST" }),
      );
    });

    test("includes Authorization header when apiKey is provided", async () => {
      (fetch as any).mockResolvedValue(makeOkResponse(makeTextResponse("Hi")));

      await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
        apiKey: "sk-test-key",
      });

      const callArgs = (fetch as any).mock.calls[0];
      expect(callArgs[1].headers["Authorization"]).toBe("Bearer sk-test-key");
    });

    test("omits Authorization header when no apiKey", async () => {
      (fetch as any).mockResolvedValue(makeOkResponse(makeTextResponse("Hi")));

      await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
      });

      const callArgs = (fetch as any).mock.calls[0];
      expect(callArgs[1].headers["Authorization"]).toBeUndefined();
    });

    test("passes model and messages in request body", async () => {
      (fetch as any).mockResolvedValue(makeOkResponse(makeTextResponse("Hi")));

      await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hello world" }],
        runtime: {},
      });

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.model).toBe(MODEL);
      expect(body.messages).toEqual([{ role: "user", content: "Hello world" }]);
    });

    test("maps normalized options and passes providerOptions through", async () => {
      (fetch as any).mockResolvedValue(makeOkResponse(makeTextResponse("Hi")));

      await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
        temperature: 0.5,
        maxOutputTokens: 100,
        providerOptions: { max_tokens: 200, reasoning_effort: "medium" },
      });

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.temperature).toBe(0.5);
      expect(body.max_tokens).toBe(200);
      expect(body.reasoning_effort).toBe("medium");
    });

    test("maps normalized reasoning to Together's request shape", async () => {
      (fetch as any).mockResolvedValue(makeOkResponse(makeTextResponse("Hi")));

      await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
        vendor: "together",
        reasoning: false,
      });

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.reasoning).toEqual({ enabled: false });
      expect(body.reasoning_effort).toBeUndefined();
    });

    test("maps named tool choice and parallel tool calls", async () => {
      (fetch as any).mockResolvedValue(makeOkResponse(makeTextResponse("Hi")));

      await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
        tools: [{ name: "lookup", description: "Lookup", schema: z.object({ q: z.string() }) }],
        toolChoice: { type: "tool", name: "lookup" },
        parallelToolCalls: false,
      });

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.tool_choice).toEqual({ type: "function", function: { name: "lookup" } });
      expect(body.parallel_tool_calls).toBe(false);
    });

    test("drops provider tools and warns without a provider tool vendor", async () => {
      const span = makeSpan();
      (fetch as any).mockResolvedValue(makeOkResponse(makeTextResponse("Hi")));

      await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: { span },
        providerTools: [{ type: "provider", name: "web_search" }],
      });

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.tools).toBeUndefined();
      expect(span.warn).toHaveBeenCalledWith(
        "providerTools not supported by ChatCompletions provider",
      );
    });

    test("maps OpenRouter provider tools and keeps function tools", async () => {
      (fetch as any).mockResolvedValue(makeOkResponse(makeTextResponse("Hi")));

      await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
        vendor: "openrouter",
        tools: [{ name: "lookup", description: "Lookup", schema: z.object({ q: z.string() }) }],
        providerTools: [
          {
            type: "provider",
            name: "web_search",
            config: { max_results: 3, allowed_domains: ["example.com"] },
          },
        ],
      });

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.tools).toHaveLength(2);
      expect(body.tools[0]).toMatchObject({
        type: "function",
        function: { name: "lookup" },
      });
      expect(body.tools[1]).toEqual({
        type: "openrouter:web_search",
        parameters: { max_results: 3, allowed_domains: ["example.com"] },
      });
    });

    test("drops unknown OpenRouter provider tools and warns", async () => {
      const span = makeSpan();
      (fetch as any).mockResolvedValue(makeOkResponse(makeTextResponse("Hi")));

      await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: { span },
        vendor: "openrouter",
        providerTools: [
          { type: "provider", name: "unknown_tool" },
          { type: "provider", name: "web_search" },
        ],
      });

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.tools).toEqual([{ type: "openrouter:web_search" }]);
      expect(span.warn).toHaveBeenCalledWith(
        "providerTool not supported by ChatCompletions provider vendor",
        { vendor: "openrouter", name: "unknown_tool" },
      );
    });
  });

  describe("response parsing", () => {
    test("parses text response", async () => {
      (fetch as any).mockResolvedValue(makeOkResponse(makeTextResponse("Hello world")));

      const result = await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
      });

      expect(result.type).toBe("success");
      if (result.type !== "success") return;
      expect(result.text).toBe("Hello world");
      expect(result.content).toEqual([{ type: "text", text: "Hello world" }]);
      expect(result.finishReason).toBe(AxleStopReason.Stop);
      expect(result.id).toBe("chatcmpl-123");
      expect(result.model).toBe(MODEL);
    });

    test("parses url citation annotations into citation parts", async () => {
      const response = makeTextResponse("See example.com for details.");
      response.choices[0].message.annotations = [
        {
          type: "url_citation",
          url_citation: {
            url: "https://example.com/news",
            title: "Example News",
            content: "A relevant excerpt.",
            start_index: 0,
            end_index: 0,
          },
        },
      ];
      (fetch as any).mockResolvedValue(makeOkResponse(response));

      const result = await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
      });

      expect(result.type).toBe("success");
      if (result.type !== "success") return;
      expect(result.content).toEqual([
        {
          type: "text",
          text: "See example.com for details.",
        },
        {
          type: "citation",
          citations: [
            {
              source: {
                type: "web",
                title: "Example News",
                url: "https://example.com/news",
                citedText: "A relevant excerpt.",
              },
              outputSpan: { start: 0, end: 0 },
              providerMetadata: { type: "url_citation" },
            },
          ],
        },
      ]);
    });

    test("parses reasoning_content into thinking part", async () => {
      const response = {
        id: "chatcmpl-123",
        model: MODEL,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "The answer is 42.",
              reasoning_content: "Let me think step by step...",
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      };
      (fetch as any).mockResolvedValue(makeOkResponse(response));

      const result = await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "What is the meaning of life?" }],
        runtime: {},
      });

      expect(result.type).toBe("success");
      if (result.type !== "success") return;
      expect(result.content).toHaveLength(2);
      expect(result.content[0]).toEqual({ type: "thinking", text: "Let me think step by step..." });
      expect(result.content[1]).toEqual({ type: "text", text: "The answer is 42." });
    });

    test("parses reasoning into thinking part", async () => {
      const response = {
        id: "chatcmpl-123",
        model: MODEL,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              reasoning: "OpenRouter reasoning text",
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      };
      (fetch as any).mockResolvedValue(makeOkResponse(response));

      const result = await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "What is the meaning of life?" }],
        runtime: {},
      });

      expect(result.type).toBe("success");
      if (result.type !== "success") return;
      expect(result.content).toEqual([{ type: "thinking", text: "OpenRouter reasoning text" }]);
    });

    test("parses tool calls with JSON.parse on arguments", async () => {
      const response = {
        id: "chatcmpl-456",
        model: MODEL,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_abc",
                  type: "function",
                  function: {
                    name: "search",
                    arguments: '{"query":"test"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 15 },
      };
      (fetch as any).mockResolvedValue(makeOkResponse(response));

      const result = await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Search for test" }],
        runtime: {},
      });

      expect(result.type).toBe("success");
      if (result.type !== "success") return;
      expect(result.finishReason).toBe(AxleStopReason.FunctionCall);
      expect(result.content).toEqual([
        { type: "tool-call", id: "call_abc", name: "search", parameters: { query: "test" } },
      ]);
    });

    test("maps usage stats", async () => {
      const response = makeTextResponse("Hi");
      response.usage = {
        prompt_tokens: 42,
        completion_tokens: 17,
        prompt_tokens_details: { cached_tokens: 30, cache_write_tokens: 9 },
        completion_tokens_details: { reasoning_tokens: 8 },
      };
      (fetch as any).mockResolvedValue(makeOkResponse(response));

      const result = await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
      });

      expect(result.type).toBe("success");
      if (result.type !== "success") return;
      expect(result.usage).toEqual({
        in: 42,
        out: 17,
        cachedIn: 30,
        cacheWriteIn: 9,
        reasoningOut: 8,
      });
    });

    test("maps alternate usage detail field names", async () => {
      const response = makeTextResponse("Hi");
      response.usage = {
        prompt_tokens: 42,
        completion_tokens: 17,
        input_tokens_details: { cached_tokens: 30, cache_creation_tokens: 9 },
        output_tokens_details: { reasoning_tokens: 8 },
      };
      (fetch as any).mockResolvedValue(makeOkResponse(response));

      const result = await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
      });

      expect(result.type).toBe("success");
      if (result.type !== "success") return;
      expect(result.usage).toEqual({
        in: 42,
        out: 17,
        cachedIn: 30,
        cacheWriteIn: 9,
        reasoningOut: 8,
      });
    });
  });

  describe("error handling", () => {
    test("returns error on HTTP failure", async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });

      const result = await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
      });

      expect(result.type).toBe("error");
    });

    test("returns error on network failure", async () => {
      (fetch as any).mockRejectedValue(new Error("Connection refused"));

      const result = await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
      });

      expect(result.type).toBe("error");
      if (result.type !== "error") return;
      expect(result.error.message).toContain("Connection refused");
    });

    test("throws on invalid tool call arguments JSON", async () => {
      const response = {
        id: "chatcmpl-789",
        model: MODEL,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_bad",
                  type: "function",
                  function: {
                    name: "search",
                    arguments: "not valid json{",
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };
      (fetch as any).mockResolvedValue(makeOkResponse(response));

      // The error propagates through getUndefinedError since fromModelResponse throws
      const result = await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
      });

      expect(result.type).toBe("error");
    });

    test("returns error when response has no choices", async () => {
      const response = { id: "chatcmpl-000", model: MODEL, choices: [] };
      (fetch as any).mockResolvedValue(makeOkResponse(response));

      const result = await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
      });

      expect(result.type).toBe("error");
    });
  });

  describe("retries", () => {
    test("retries network errors then succeeds", async () => {
      vi.useFakeTimers();
      (fetch as any)
        .mockRejectedValueOnce(new Error("Connection reset"))
        .mockResolvedValueOnce(makeOkResponse(makeTextResponse("Recovered")));

      const pending = createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
        maxRetries: 1,
      });

      await vi.runAllTimersAsync();
      const result = await pending;

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result.type).toBe("success");
      vi.useRealTimers();
    });

    test("retries retryable HTTP statuses then succeeds", async () => {
      vi.useFakeTimers();
      (fetch as any)
        .mockResolvedValueOnce(makeErrorResponse(429, "Rate limited"))
        .mockResolvedValueOnce(makeOkResponse(makeTextResponse("Recovered")));

      const pending = createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
        maxRetries: 1,
      });

      await vi.runAllTimersAsync();
      const result = await pending;

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result.type).toBe("success");
      vi.useRealTimers();
    });

    test("does not retry non-retryable HTTP statuses", async () => {
      (fetch as any).mockResolvedValue(makeErrorResponse(400, "Bad request"));

      const result = await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
      });

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.type).toBe("error");
    });

    test("honors retry-after-ms header", async () => {
      vi.useFakeTimers();
      (fetch as any)
        .mockResolvedValueOnce(makeErrorResponse(503, "Unavailable", { "retry-after-ms": "25" }))
        .mockResolvedValueOnce(makeOkResponse(makeTextResponse("Recovered")));

      const pending = createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
        maxRetries: 1,
      });

      await vi.advanceTimersByTimeAsync(24);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      const result = await pending;

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result.type).toBe("success");
      vi.useRealTimers();
    });

    test("retries request timeouts then succeeds", async () => {
      vi.useFakeTimers();
      (fetch as any)
        .mockImplementationOnce((_url: string, init: RequestInit) => {
          return new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
              once: true,
            });
          });
        })
        .mockResolvedValueOnce(makeOkResponse(makeTextResponse("Recovered")));

      const pending = createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
        maxRetries: 1,
        timeoutMs: 25,
      });

      await vi.advanceTimersByTimeAsync(25);
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result.type).toBe("success");
      vi.useRealTimers();
    });
  });
});

// Helpers

function makeTextResponse(text: string): ChatCompletionResponse {
  return {
    id: "chatcmpl-123",
    model: MODEL,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  };
}

function makeOkResponse(data: any) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

function makeErrorResponse(status: number, text: string, headers: Record<string, string> = {}) {
  return {
    ok: false,
    status,
    headers: new Headers(headers),
    text: () => Promise.resolve(text),
  };
}

function makeSpan() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as any;
}
