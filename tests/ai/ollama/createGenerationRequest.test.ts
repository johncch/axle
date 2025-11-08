import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Chat } from "../../../src/messages/chat.js";
import { AxleStopReason } from "../../../src/ai/types.js";
import { createGenerationRequest } from "../../../src/ai/ollama/createGenerationRequest.js";

// Mock fetch globally
global.fetch = jest.fn() as any;

describe("createGenerationRequest (Ollama)", () => {
  const mockUrl = "http://localhost:11434";
  const mockModel = "llama2";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("parameter normalization", () => {
    test("should convert max_tokens to num_predict", async () => {
      ((global.fetch as jest.Mock).mockResolvedValue as any)({
        ok: true,
        json: async () => ({
          model: mockModel,
          done_reason: "stop",
          message: {
            role: "assistant",
            content: "Hello",
          },
          prompt_eval_count: 10,
          eval_count: 20,
        }),
      });

      const chat = new Chat();
      chat.addUser("Hello");

      await createGenerationRequest({
        url: mockUrl,
        model: mockModel,
        messages: chat.messages,
        context: {},
        options: { max_tokens: 1000 },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        `${mockUrl}/api/chat`,
        expect.objectContaining({
          body: expect.stringContaining('"num_predict":1000'),
        }),
      );

      const requestBody = JSON.parse(((global.fetch as jest.Mock).mock.calls[0][1] as any).body);
      expect(requestBody.options.num_predict).toBe(1000);
      expect(requestBody.options.max_tokens).toBeUndefined();
    });

    test("should pass through other options unchanged", async () => {
      ((global.fetch as jest.Mock).mockResolvedValue as any)({
        ok: true,
        json: async () => ({
          model: mockModel,
          done_reason: "stop",
          message: {
            role: "assistant",
            content: "Hello",
          },
          prompt_eval_count: 10,
          eval_count: 20,
        }),
      });

      const chat = new Chat();
      chat.addUser("Hello");

      await createGenerationRequest({
        url: mockUrl,
        model: mockModel,
        messages: chat.messages,
        context: {},
        options: {
          temperature: 0.7,
          top_p: 0.9,
          stop: ["STOP"],
        },
      });

      const requestBody = JSON.parse((((global.fetch as jest.Mock).mock.calls[0][1] as any).body));
      expect(requestBody.options.temperature).toBe(0.7);
      expect(requestBody.options.top_p).toBe(0.9);
      expect(requestBody.options.stop).toEqual(["STOP"]);
    });

    test("should use default temperature when no options provided", async () => {
      ((global.fetch as jest.Mock).mockResolvedValue as any)({
        ok: true,
        json: async () => ({
          model: mockModel,
          done_reason: "stop",
          message: {
            role: "assistant",
            content: "Hello",
          },
          prompt_eval_count: 10,
          eval_count: 20,
        }),
      });

      const chat = new Chat();
      chat.addUser("Hello");

      await createGenerationRequest({
        url: mockUrl,
        model: mockModel,
        messages: chat.messages,
        context: {},
      });

      const requestBody = JSON.parse((((global.fetch as jest.Mock).mock.calls[0][1] as any).body));
      expect(requestBody.options.temperature).toBe(0.7);
    });

    test("should include system message when provided", async () => {
      ((global.fetch as jest.Mock).mockResolvedValue as any)({
        ok: true,
        json: async () => ({
          model: mockModel,
          done_reason: "stop",
          message: {
            role: "assistant",
            content: "Hello",
          },
          prompt_eval_count: 10,
          eval_count: 20,
        }),
      });

      const chat = new Chat();
      chat.addUser("Hello");

      await createGenerationRequest({
        url: mockUrl,
        model: mockModel,
        messages: chat.messages,
        system: "You are a helpful assistant",
        context: {},
      });

      const requestBody = JSON.parse((((global.fetch as jest.Mock).mock.calls[0][1] as any).body));
      expect(requestBody.system).toBe("You are a helpful assistant");
    });
  });

  describe("successful responses", () => {
    test("should handle text-only response", async () => {
      ((global.fetch as jest.Mock).mockResolvedValue as any)({
        ok: true,
        json: async () => ({
          model: mockModel,
          done_reason: "stop",
          message: {
            role: "assistant",
            content: "Hello, how can I help?",
          },
          prompt_eval_count: 10,
          eval_count: 20,
        }),
      });

      const chat = new Chat();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        url: mockUrl,
        model: mockModel,
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.model).toBe(mockModel);
        expect(result.role).toBe("assistant");
        expect(result.finishReason).toBe(AxleStopReason.Stop);
        expect(result.text).toBe("Hello, how can I help?");
        expect(result.usage.in).toBe(10);
        expect(result.usage.out).toBe(20);
      }
    });

    test("should handle response with tool calls", async () => {
      ((global.fetch as jest.Mock).mockResolvedValue as any)({
        ok: true,
        json: async () => ({
          model: mockModel,
          done_reason: "stop",
          message: {
            role: "assistant",
            content: "Let me search for that.",
            tool_calls: [
              {
                id: "call_123",
                function: {
                  name: "search",
                  arguments: { query: "test" },
                },
              },
            ],
          },
          prompt_eval_count: 10,
          eval_count: 20,
        }),
      });

      const chat = new Chat();
      chat.addUser("Search for test");

      const result = await createGenerationRequest({
        url: mockUrl,
        model: mockModel,
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.finishReason).toBe(AxleStopReason.FunctionCall);
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0]).toEqual({
          type: "tool-call",
          id: "call_123",
          name: "search",
          parameters: { query: "test" },
        });
      }
    });

    test("should handle multiple tool calls", async () => {
      ((global.fetch as jest.Mock).mockResolvedValue as any)({
        ok: true,
        json: async () => ({
          model: mockModel,
          done_reason: "stop",
          message: {
            role: "assistant",
            content: "Processing your request",
            tool_calls: [
              {
                id: "call_1",
                function: {
                  name: "search",
                  arguments: { query: "first" },
                },
              },
              {
                id: "call_2",
                function: {
                  name: "calculate",
                  arguments: { expression: "2+2" },
                },
              },
            ],
          },
          prompt_eval_count: 15,
          eval_count: 25,
        }),
      });

      const chat = new Chat();
      chat.addUser("Search and calculate");

      const result = await createGenerationRequest({
        url: mockUrl,
        model: mockModel,
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.finishReason).toBe(AxleStopReason.FunctionCall);
        expect(result.toolCalls).toHaveLength(2);
        expect(result.toolCalls[0].name).toBe("search");
        expect(result.toolCalls[1].name).toBe("calculate");
      }
    });

    test("should handle missing usage counts", async () => {
      ((global.fetch as jest.Mock).mockResolvedValue as any)({
        ok: true,
        json: async () => ({
          model: mockModel,
          done_reason: "stop",
          message: {
            role: "assistant",
            content: "Hello",
          },
        }),
      });

      const chat = new Chat();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        url: mockUrl,
        model: mockModel,
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.usage.in).toBe(0);
        expect(result.usage.out).toBe(0);
      }
    });
  });

  describe("error handling", () => {
    test("should handle HTTP errors", async () => {
      ((global.fetch as jest.Mock).mockResolvedValue as any)({
        ok: false,
        status: 500,
      });

      const chat = new Chat();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        url: mockUrl,
        model: mockModel,
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error.message).toContain("HTTP error! status: 500");
      }
    });

    test("should handle network errors", async () => {
      ((global.fetch as jest.Mock).mockRejectedValue as any)(
        new Error("Network connection failed"),
      );

      const chat = new Chat();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        url: mockUrl,
        model: mockModel,
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error.message).toContain("Network connection failed");
      }
    });

    test("should handle invalid JSON response", async () => {
      ((global.fetch as jest.Mock).mockResolvedValue as any)({
        ok: true,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      const chat = new Chat();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        url: mockUrl,
        model: mockModel,
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("error");
    });

    test("should throw error for invalid tool call arguments (string)", async () => {
      ((global.fetch as jest.Mock).mockResolvedValue as any)({
        ok: true,
        json: async () => ({
          model: mockModel,
          done_reason: "stop",
          message: {
            role: "assistant",
            content: "Result",
            tool_calls: [
              {
                id: "call_123",
                function: {
                  name: "search",
                  arguments: "invalid string",
                },
              },
            ],
          },
        }),
      });

      const chat = new Chat();
      chat.addUser("Search");

      const result = await createGenerationRequest({
        url: mockUrl,
        model: mockModel,
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error.message).toContain("Invalid tool call arguments for search");
      }
    });

    test("should throw error for invalid tool call arguments (null)", async () => {
      ((global.fetch as jest.Mock).mockResolvedValue as any)({
        ok: true,
        json: async () => ({
          model: mockModel,
          done_reason: "stop",
          message: {
            role: "assistant",
            content: "Result",
            tool_calls: [
              {
                id: "call_123",
                function: {
                  name: "search",
                  arguments: null,
                },
              },
            ],
          },
        }),
      });

      const chat = new Chat();
      chat.addUser("Search");

      const result = await createGenerationRequest({
        url: mockUrl,
        model: mockModel,
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error.message).toContain("Invalid tool call arguments for search");
      }
    });

    test("should throw error for invalid tool call arguments (array)", async () => {
      ((global.fetch as jest.Mock).mockResolvedValue as any)({
        ok: true,
        json: async () => ({
          model: mockModel,
          done_reason: "stop",
          message: {
            role: "assistant",
            content: "Result",
            tool_calls: [
              {
                id: "call_123",
                function: {
                  name: "search",
                  arguments: ["invalid", "array"],
                },
              },
            ],
          },
        }),
      });

      const chat = new Chat();
      chat.addUser("Search");

      const result = await createGenerationRequest({
        url: mockUrl,
        model: mockModel,
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error.message).toContain("Invalid tool call arguments for search");
      }
    });

    test("should return error for unrecognized done_reason", async () => {
      ((global.fetch as jest.Mock).mockResolvedValue as any)({
        ok: true,
        json: async () => ({
          model: mockModel,
          done_reason: "unknown",
          message: {
            role: "assistant",
            content: "Hello",
          },
        }),
      });

      const chat = new Chat();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        url: mockUrl,
        model: mockModel,
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error.type).toBe("OllamaError");
        expect(result.error.message).toBe("Unexpected error from Ollama");
      }
    });

    test("should return error for missing message", async () => {
      ((global.fetch as jest.Mock).mockResolvedValue as any)({
        ok: true,
        json: async () => ({
          model: mockModel,
          done_reason: "stop",
        }),
      });

      const chat = new Chat();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        url: mockUrl,
        model: mockModel,
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error.type).toBe("OllamaError");
      }
    });
  });

  describe("edge cases", () => {
    test("should handle empty content", async () => {
      ((global.fetch as jest.Mock).mockResolvedValue as any)({
        ok: true,
        json: async () => ({
          model: mockModel,
          done_reason: "stop",
          message: {
            role: "assistant",
            content: "",
          },
          prompt_eval_count: 10,
          eval_count: 0,
        }),
      });

      const chat = new Chat();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        url: mockUrl,
        model: mockModel,
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.text).toBe("");
        expect(result.content).toHaveLength(1);
        expect(result.content[0].text).toBe("");
      }
    });

    test("should include raw response in result", async () => {
      const mockResponse = {
        model: mockModel,
        done_reason: "stop",
        message: {
          role: "assistant",
          content: "Hello",
        },
        prompt_eval_count: 10,
        eval_count: 20,
      };

      ((global.fetch as jest.Mock).mockResolvedValue as any)({
        ok: true,
        json: async () => mockResponse,
      });

      const chat = new Chat();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        url: mockUrl,
        model: mockModel,
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.raw).toEqual(mockResponse);
      }
    });

    test("should generate unique IDs with timestamp", async () => {
      ((global.fetch as jest.Mock).mockResolvedValue as any)({
        ok: true,
        json: async () => ({
          model: mockModel,
          done_reason: "stop",
          message: {
            role: "assistant",
            content: "Hello",
          },
        }),
      });

      const chat = new Chat();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        url: mockUrl,
        model: mockModel,
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.id).toMatch(/^ollama-\d+$/);
      }
    });

    test("should include raw response in error results", async () => {
      const mockErrorResponse = {
        model: mockModel,
        done_reason: "error",
        error: "Something went wrong",
      };

      ((global.fetch as jest.Mock).mockResolvedValue as any)({
        ok: true,
        json: async () => mockErrorResponse,
      });

      const chat = new Chat();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        url: mockUrl,
        model: mockModel,
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.raw).toEqual(mockErrorResponse);
      }
    });
  });
});
