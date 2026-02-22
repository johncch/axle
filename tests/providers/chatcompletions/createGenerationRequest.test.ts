import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createGenerationRequest } from "../../../src/providers/chatcompletions/createGenerationRequest.js";
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

  describe("request construction", () => {
    test("sends POST to {baseUrl}/chat/completions", async () => {
      const mockResponse = makeTextResponse("Hello");
      (fetch as any).mockResolvedValue(makeOkResponse(mockResponse));

      await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        context: {},
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
        context: {},
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
        context: {},
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
        context: {},
      });

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.model).toBe(MODEL);
      expect(body.messages).toEqual([{ role: "user", content: "Hello world" }]);
    });

    test("passes options through to request body", async () => {
      (fetch as any).mockResolvedValue(makeOkResponse(makeTextResponse("Hi")));

      await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        context: {},
        options: { temperature: 0.5, max_tokens: 100 },
      });

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.temperature).toBe(0.5);
      expect(body.max_tokens).toBe(100);
    });
  });

  describe("response parsing", () => {
    test("parses text response", async () => {
      (fetch as any).mockResolvedValue(makeOkResponse(makeTextResponse("Hello world")));

      const result = await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        context: {},
      });

      expect(result.type).toBe("success");
      if (result.type !== "success") return;
      expect(result.text).toBe("Hello world");
      expect(result.content).toEqual([{ type: "text", text: "Hello world" }]);
      expect(result.finishReason).toBe(AxleStopReason.Stop);
      expect(result.id).toBe("chatcmpl-123");
      expect(result.model).toBe(MODEL);
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
        context: {},
      });

      expect(result.type).toBe("success");
      if (result.type !== "success") return;
      expect(result.content).toHaveLength(2);
      expect(result.content[0]).toEqual({ type: "thinking", text: "Let me think step by step..." });
      expect(result.content[1]).toEqual({ type: "text", text: "The answer is 42." });
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
        context: {},
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
      response.usage = { prompt_tokens: 42, completion_tokens: 17 };
      (fetch as any).mockResolvedValue(makeOkResponse(response));

      const result = await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        context: {},
      });

      expect(result.type).toBe("success");
      if (result.type !== "success") return;
      expect(result.usage).toEqual({ in: 42, out: 17 });
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
        context: {},
      });

      expect(result.type).toBe("error");
    });

    test("returns error on network failure", async () => {
      (fetch as any).mockRejectedValue(new Error("Connection refused"));

      const result = await createGenerationRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        context: {},
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
        context: {},
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
        context: {},
      });

      expect(result.type).toBe("error");
    });
  });
});

// Helpers

function makeTextResponse(text: string) {
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
