import { FinishReason, GoogleGenAI } from "@google/genai";
import { type Mock, beforeEach, describe, expect, test, vi } from "vitest";
import { Conversation } from "../../../src/messages/conversation.js";
import { createGenerationRequest } from "../../../src/providers/gemini/createGenerationRequest.js";
import { AxleStopReason } from "../../../src/providers/types.js";

describe("createGenerationRequest (Google AI)", () => {
  let mockClient: GoogleGenAI;
  let mockGenerateContent: Mock;

  beforeEach(() => {
    mockGenerateContent = vi.fn() as any;
    mockClient = {
      models: {
        generateContent: mockGenerateContent,
      },
    } as any;
  });

  describe("parameter normalization", () => {
    test("should convert max_tokens to maxOutputTokens", async () => {
      (mockGenerateContent.mockResolvedValue as any)({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Hello" }] },
            finishReason: FinishReason.STOP,
            index: 0,
          },
        ],
        usageMetadata: { promptTokenCount: 10, totalTokenCount: 30 },
      });

      const chat = new Conversation();
      chat.addUser("Hello");

      await createGenerationRequest({
        client: mockClient,
        model: "gemini-2.0-flash",
        messages: chat.messages,
        context: {},
        options: { max_tokens: 1000 },
      });

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            maxOutputTokens: 1000,
          }),
        }),
      );
      expect((mockGenerateContent.mock.calls[0][0] as any).config).not.toHaveProperty("max_tokens");
    });

    test("should convert stop string to stopSequences array", async () => {
      (mockGenerateContent.mockResolvedValue as any)({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Hello" }] },
            finishReason: FinishReason.STOP,
            index: 0,
          },
        ],
        usageMetadata: { promptTokenCount: 10, totalTokenCount: 30 },
      });

      const chat = new Conversation();
      chat.addUser("Hello");

      await createGenerationRequest({
        client: mockClient,
        model: "gemini-2.0-flash",
        messages: chat.messages,
        context: {},
        options: { stop: "STOP" },
      });

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            stopSequences: ["STOP"],
          }),
        }),
      );
    });

    test("should convert stop array to stopSequences", async () => {
      (mockGenerateContent.mockResolvedValue as any)({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Hello" }] },
            finishReason: FinishReason.STOP,
            index: 0,
          },
        ],
        usageMetadata: { promptTokenCount: 10, totalTokenCount: 30 },
      });

      const chat = new Conversation();
      chat.addUser("Hello");

      await createGenerationRequest({
        client: mockClient,
        model: "gemini-2.0-flash",
        messages: chat.messages,
        context: {},
        options: { stop: ["STOP1", "STOP2"] },
      });

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            stopSequences: ["STOP1", "STOP2"],
          }),
        }),
      );
    });

    test("should convert top_p to topP", async () => {
      (mockGenerateContent.mockResolvedValue as any)({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Hello" }] },
            finishReason: FinishReason.STOP,
            index: 0,
          },
        ],
        usageMetadata: { promptTokenCount: 10, totalTokenCount: 30 },
      });

      const chat = new Conversation();
      chat.addUser("Hello");

      await createGenerationRequest({
        client: mockClient,
        model: "gemini-2.0-flash",
        messages: chat.messages,
        context: {},
        options: { top_p: 0.9 },
      });

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            topP: 0.9,
          }),
        }),
      );
      expect((mockGenerateContent.mock.calls[0][0] as any).config).not.toHaveProperty("top_p");
    });

    test("should pass through temperature unchanged", async () => {
      (mockGenerateContent.mockResolvedValue as any)({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Hello" }] },
            finishReason: FinishReason.STOP,
            index: 0,
          },
        ],
        usageMetadata: { promptTokenCount: 10, totalTokenCount: 30 },
      });

      const chat = new Conversation();
      chat.addUser("Hello");

      await createGenerationRequest({
        client: mockClient,
        model: "gemini-2.0-flash",
        messages: chat.messages,
        context: {},
        options: { temperature: 0.7 },
      });

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            temperature: 0.7,
          }),
        }),
      );
    });
  });

  describe("successful responses", () => {
    test("should handle text-only response", async () => {
      (mockGenerateContent.mockResolvedValue as any)({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Hello, how can I help?" }] },
            finishReason: FinishReason.STOP,
            index: 0,
          },
        ],
        usageMetadata: { promptTokenCount: 10, totalTokenCount: 30 },
      });

      const chat = new Conversation();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        client: mockClient,
        model: "gemini-2.0-flash",
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.id).toBe("resp_123");
        expect(result.model).toBe("gemini-2.0-flash");
        expect(result.role).toBe("assistant");
        expect(result.finishReason).toBe(AxleStopReason.Stop);
        expect(result.text).toBe("Hello, how can I help?");
        expect(result.usage.in).toBe(10);
        expect(result.usage.out).toBe(20);
      }
    });

    test("should handle response with function calls", async () => {
      (mockGenerateContent.mockResolvedValue as any)({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [] },
            finishReason: FinishReason.STOP,
            index: 0,
          },
        ],
        functionCalls: [
          {
            id: "call_123",
            name: "search",
            args: { query: "test" },
          },
        ],
        usageMetadata: { promptTokenCount: 10, totalTokenCount: 25 },
      });

      const chat = new Conversation();
      chat.addUser("Search for test");

      const result = await createGenerationRequest({
        client: mockClient,
        model: "gemini-2.0-flash",
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.finishReason).toBe(AxleStopReason.FunctionCall);
        const toolCalls = result.content.filter((c) => c.type === "tool-call");
        expect(toolCalls).toHaveLength(1);
        expect(toolCalls[0]).toEqual({
          type: "tool-call",
          id: "call_123",
          name: "search",
          parameters: { query: "test" },
        });
      }
    });

    test("should handle MAX_TOKENS finish reason", async () => {
      (mockGenerateContent.mockResolvedValue as any)({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Incomplete..." }] },
            finishReason: FinishReason.MAX_TOKENS,
            index: 0,
          },
        ],
        usageMetadata: { promptTokenCount: 10, totalTokenCount: 110 },
      });

      const chat = new Conversation();
      chat.addUser("Write a long essay");

      const result = await createGenerationRequest({
        client: mockClient,
        model: "gemini-2.0-flash",
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.finishReason).toBe(AxleStopReason.Length);
      }
    });

    test("should handle multiple text parts", async () => {
      (mockGenerateContent.mockResolvedValue as any)({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "Hello" }, { text: ", " }, { text: "world!" }],
            },
            finishReason: FinishReason.STOP,
            index: 0,
          },
        ],
        usageMetadata: { promptTokenCount: 10, totalTokenCount: 25 },
      });

      const chat = new Conversation();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        client: mockClient,
        model: "gemini-2.0-flash",
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.text).toBe("Hello, world!");
      }
    });
  });

  describe("error handling", () => {
    test("should handle network errors", async () => {
      (mockGenerateContent.mockRejectedValue as any)(new Error("Network error"));

      const chat = new Conversation();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        client: mockClient,
        model: "gemini-2.0-flash",
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error.message).toContain("Network error");
      }
    });

    test("should handle blocked response", async () => {
      (mockGenerateContent.mockResolvedValue as any)({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        promptFeedback: {
          blockReason: "SAFETY",
          blockReasonMessage: "Content blocked for safety",
        },
        usageMetadata: { promptTokenCount: 10, totalTokenCount: 10 },
      });

      const chat = new Conversation();
      chat.addUser("Dangerous content");

      const result = await createGenerationRequest({
        client: mockClient,
        model: "gemini-2.0-flash",
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error.type).toBe("Blocked");
        expect(result.error.message).toContain("blocked by Google AI");
      }
    });

    test("should handle empty candidates", async () => {
      (mockGenerateContent.mockResolvedValue as any)({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [],
        usageMetadata: { promptTokenCount: 10, totalTokenCount: 10 },
      });

      const chat = new Conversation();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        client: mockClient,
        model: "gemini-2.0-flash",
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error.type).toBe("InvalidResponse");
      }
    });

    test("should handle SAFETY finish reason", async () => {
      (mockGenerateContent.mockResolvedValue as any)({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [] },
            finishReason: FinishReason.SAFETY,
            index: 0,
          },
        ],
        usageMetadata: { promptTokenCount: 10, totalTokenCount: 10 },
      });

      const chat = new Conversation();
      chat.addUser("Content");

      const result = await createGenerationRequest({
        client: mockClient,
        model: "gemini-2.0-flash",
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error.message).toContain("Unexpected stop reason");
      }
    });

    test("should return error when function call args are invalid", async () => {
      (mockGenerateContent.mockResolvedValue as any)({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [] },
            finishReason: FinishReason.STOP,
            index: 0,
          },
        ],
        functionCalls: [
          {
            id: "call_123",
            name: "search",
            args: "invalid", // String instead of object
          },
        ],
        usageMetadata: { promptTokenCount: 10, totalTokenCount: 25 },
      });

      const chat = new Conversation();
      chat.addUser("Search");

      const result = await createGenerationRequest({
        client: mockClient,
        model: "gemini-2.0-flash",
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error.message).toContain("Invalid tool call arguments for search");
      }
    });
  });

  describe("edge cases", () => {
    test("should handle undefined options", async () => {
      (mockGenerateContent.mockResolvedValue as any)({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Hello" }] },
            finishReason: FinishReason.STOP,
            index: 0,
          },
        ],
        usageMetadata: { promptTokenCount: 10, totalTokenCount: 20 },
      });

      const chat = new Conversation();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        client: mockClient,
        model: "gemini-2.0-flash",
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("success");
    });

    test("should handle empty text in response", async () => {
      (mockGenerateContent.mockResolvedValue as any)({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [{ text: "" }] },
            finishReason: FinishReason.STOP,
            index: 0,
          },
        ],
        usageMetadata: { promptTokenCount: 10, totalTokenCount: 10 },
      });

      const chat = new Conversation();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        client: mockClient,
        model: "gemini-2.0-flash",
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.text).toBe("");
      }
    });

    test("should include raw response in result", async () => {
      const mockResponse = {
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Hello" }] },
            finishReason: FinishReason.STOP,
            index: 0,
          },
        ],
        usageMetadata: { promptTokenCount: 10, totalTokenCount: 20 },
      };

      (mockGenerateContent.mockResolvedValue as any)(mockResponse);

      const chat = new Conversation();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        client: mockClient,
        model: "gemini-2.0-flash",
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.raw).toEqual(mockResponse);
      }
    });
  });
});
