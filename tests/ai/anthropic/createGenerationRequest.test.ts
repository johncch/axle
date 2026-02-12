import Anthropic from "@anthropic-ai/sdk";
import { type Mock, beforeEach, describe, expect, test, vi } from "vitest";
import { History } from "../../../src/messages/history.js";
import { createGenerationRequest } from "../../../src/providers/anthropic/createGenerationRequest.js";
import { AxleStopReason } from "../../../src/providers/types.js";

describe("createGenerationRequest (Anthropic)", () => {
  let mockClient: Anthropic;
  let mockCreate: Mock;

  beforeEach(() => {
    mockCreate = vi.fn() as any;
    mockClient = {
      messages: {
        create: mockCreate,
      },
    } as any;
  });

  describe("parameter normalization", () => {
    test("should convert stop string to stop_sequences array", async () => {
      (mockCreate.mockResolvedValue as any)({
        id: "msg_123",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
        model: "claude-3-5-sonnet-20241022",
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 20 },
      });

      const chat = new History();
      chat.addUser("Hello");

      await createGenerationRequest({
        client: mockClient,
        model: "claude-3-5-sonnet-20241022",
        messages: chat.messages,
        context: {},
        options: { stop: "STOP" },
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          stop_sequences: ["STOP"],
        }),
      );
      expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("stop");
    });

    test("should convert stop array to stop_sequences", async () => {
      (mockCreate.mockResolvedValue as any)({
        id: "msg_123",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
        model: "claude-3-5-sonnet-20241022",
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 20 },
      });

      const chat = new History();
      chat.addUser("Hello");

      await createGenerationRequest({
        client: mockClient,
        model: "claude-3-5-sonnet-20241022",
        messages: chat.messages,
        context: {},
        options: { stop: ["STOP1", "STOP2"] },
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          stop_sequences: ["STOP1", "STOP2"],
        }),
      );
    });

    test("should pass through other options unchanged", async () => {
      (mockCreate.mockResolvedValue as any)({
        id: "msg_123",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
        model: "claude-3-5-sonnet-20241022",
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 20 },
      });

      const chat = new History();
      chat.addUser("Hello");

      await createGenerationRequest({
        client: mockClient,
        model: "claude-3-5-sonnet-20241022",
        messages: chat.messages,
        context: {},
        options: {
          temperature: 0.7,
          top_p: 0.9,
          max_tokens: 1000,
        },
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
          top_p: 0.9,
          max_tokens: 1000,
        }),
      );
    });

    test("should include system message when provided", async () => {
      (mockCreate.mockResolvedValue as any)({
        id: "msg_123",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
        model: "claude-3-5-sonnet-20241022",
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 20 },
      });

      const chat = new History();
      chat.addUser("Hello");

      await createGenerationRequest({
        client: mockClient,
        model: "claude-3-5-sonnet-20241022",
        messages: chat.messages,
        system: "You are a helpful assistant",
        context: {},
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: "You are a helpful assistant",
        }),
      );
    });
  });

  describe("successful responses", () => {
    test("should handle text-only response", async () => {
      (mockCreate.mockResolvedValue as any)({
        id: "msg_123",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hello, how can I help?" }],
        model: "claude-3-5-sonnet-20241022",
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 20 },
      });

      const chat = new History();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        client: mockClient,
        model: "claude-3-5-sonnet-20241022",
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.id).toBe("msg_123");
        expect(result.model).toBe("claude-3-5-sonnet-20241022");
        expect(result.role).toBe("assistant");
        expect(result.finishReason).toBe(AxleStopReason.Stop);
        expect(result.text).toBe("Hello, how can I help?");
        expect(result.usage.in).toBe(10);
        expect(result.usage.out).toBe(20);
      }
    });

    test("should handle response with tool calls", async () => {
      (mockCreate.mockResolvedValue as any)({
        id: "msg_123",
        type: "message",
        role: "assistant",
        content: [
          { type: "text", text: "Let me search for that." },
          {
            type: "tool_use",
            id: "toolu_123",
            name: "search",
            input: { query: "test" },
          },
        ],
        model: "claude-3-5-sonnet-20241022",
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 20 },
      });

      const chat = new History();
      chat.addUser("Search for test");

      const result = await createGenerationRequest({
        client: mockClient,
        model: "claude-3-5-sonnet-20241022",
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.finishReason).toBe(AxleStopReason.FunctionCall);
        expect(result.content).toHaveLength(2);
        expect(result.content[0]).toEqual({
          type: "text",
          text: "Let me search for that.",
        });
        expect(result.content[1]).toEqual({
          type: "tool-call",
          id: "toolu_123",
          name: "search",
          parameters: { query: "test" },
        });
      }
    });

    test("should handle thinking content", async () => {
      (mockCreate.mockResolvedValue as any)({
        id: "msg_123",
        type: "message",
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me think..." },
          { type: "text", text: "Here's my answer" },
        ],
        model: "claude-3-5-sonnet-20241022",
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 30 },
      });

      const chat = new History();
      chat.addUser("Question");

      const result = await createGenerationRequest({
        client: mockClient,
        model: "claude-3-5-sonnet-20241022",
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toHaveLength(2);
        expect(result.content[0].type).toBe("thinking");
        expect(result.content[1].type).toBe("text");
      }
    });

    test("should handle max_tokens stop reason", async () => {
      (mockCreate.mockResolvedValue as any)({
        id: "msg_123",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Incomplete..." }],
        model: "claude-3-5-sonnet-20241022",
        stop_reason: "max_tokens",
        usage: { input_tokens: 10, output_tokens: 100 },
      });

      const chat = new History();
      chat.addUser("Write a long essay");

      const result = await createGenerationRequest({
        client: mockClient,
        model: "claude-3-5-sonnet-20241022",
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.finishReason).toBe(AxleStopReason.Length);
      }
    });
  });

  describe("error handling", () => {
    test("should handle network errors", async () => {
      (mockCreate.mockRejectedValue as any)(new Error("Network error"));

      const chat = new History();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        client: mockClient,
        model: "claude-3-5-sonnet-20241022",
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error.message).toContain("Network error");
      }
    });

    test("should handle API errors", async () => {
      const apiError = new Error("Rate limit exceeded");
      (apiError as any).status = 429;
      (mockCreate.mockRejectedValue as any)(apiError);

      const chat = new History();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        client: mockClient,
        model: "claude-3-5-sonnet-20241022",
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("error");
    });

    test("should handle unrecognized stop reasons", async () => {
      (mockCreate.mockResolvedValue as any)({
        id: "msg_123",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
        model: "claude-3-5-sonnet-20241022",
        stop_reason: "unknown_reason",
        usage: { input_tokens: 10, output_tokens: 20 },
      });

      const chat = new History();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        client: mockClient,
        model: "claude-3-5-sonnet-20241022",
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error.message).toContain("Stop reason is not recognized");
      }
    });
  });

  describe("edge cases", () => {
    test("should handle options being undefined", async () => {
      (mockCreate.mockResolvedValue as any)({
        id: "msg_123",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
        model: "claude-3-5-sonnet-20241022",
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 20 },
      });

      const chat = new History();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        client: mockClient,
        model: "claude-3-5-sonnet-20241022",
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("success");
    });

    test("should handle empty content array", async () => {
      (mockCreate.mockResolvedValue as any)({
        id: "msg_123",
        type: "message",
        role: "assistant",
        content: [],
        model: "claude-3-5-sonnet-20241022",
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 0 },
      });

      const chat = new History();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        client: mockClient,
        model: "claude-3-5-sonnet-20241022",
        messages: chat.messages,
        context: {},
      });

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toHaveLength(0);
        expect(result.text).toBe("");
      }
    });

    test("should include raw response in result", async () => {
      const mockResponse = {
        id: "msg_123",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
        model: "claude-3-5-sonnet-20241022",
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 20 },
      };

      (mockCreate.mockResolvedValue as any)(mockResponse);

      const chat = new History();
      chat.addUser("Hello");

      const result = await createGenerationRequest({
        client: mockClient,
        model: "claude-3-5-sonnet-20241022",
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
