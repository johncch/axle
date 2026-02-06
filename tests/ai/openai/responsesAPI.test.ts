import { Response } from "openai/resources/responses/responses.js";
import { describe, expect, test } from "vitest";
import { fromModelResponse } from "../../../src/providers/openai/responsesAPI.js";

describe("responsesAPI", () => {
  describe("fromModelResponse", () => {
    test("should convert basic response with text output", () => {
      const response = {
        id: "resp_123",
        created_at: 1234567890,
        output_text: "Hello, how can I help you?",
        error: null,
        incomplete_details: null,
        instructions: null,
        metadata: {},
        model: "gpt-4o",
        object: "response",
        output: [
          {
            type: "message",
            id: "msg_123",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Hello, how can I help you?",
              },
            ],
          },
        ],
        status: "completed",
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30,
        },
      } as Response;

      const result = fromModelResponse(response);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.id).toBe("resp_123");
        expect(result.model).toBe("gpt-4o");
        expect(result.content).toHaveLength(1);
        expect(result.content[0]).toEqual({
          type: "text",
          text: "Hello, how can I help you?",
        });
        expect(result.text).toBe("Hello, how can I help you?");
        expect(result.usage.in).toBe(10);
        expect(result.usage.out).toBe(20);
      }
    });

    test("should convert response with reasoning content", () => {
      const response = {
        id: "resp_456",
        created_at: 1234567890,
        output_text: "The answer is 42.",
        error: null,
        incomplete_details: null,
        instructions: null,
        metadata: {},
        model: "o4-mini",
        object: "response",
        output: [
          {
            type: "reasoning",
            id: "rs_123",
            summary: [
              {
                type: "summary_text",
                text: "Let me think about this problem step by step...",
              },
            ],
          },
          {
            type: "message",
            id: "msg_456",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "The answer is 42.",
              },
            ],
          },
        ],
        status: "completed",
        usage: {
          input_tokens: 50,
          output_tokens: 100,
          total_tokens: 150,
        },
      } as Response;

      const result = fromModelResponse(response);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toHaveLength(2);

        // First content part should be thinking
        expect(result.content[0]).toEqual({
          type: "thinking",
          text: "Let me think about this problem step by step...",
        });

        // Second content part should be text
        expect(result.content[1]).toEqual({
          type: "text",
          text: "The answer is 42.",
        });

        expect(result.text).toBe("The answer is 42.");
      }
    });

    test("should convert response with multiple reasoning blocks", () => {
      const response = {
        id: "resp_789",
        created_at: 1234567890,
        output_text: "Here's my final answer.",
        error: null,
        incomplete_details: null,
        instructions: null,
        metadata: {},
        model: "o4-mini",
        object: "response",
        output: [
          {
            type: "reasoning",
            id: "rs_1",
            summary: [
              {
                type: "summary_text",
                text: "First, I need to understand the question...",
              },
            ],
          },
          {
            type: "reasoning",
            id: "rs_2",
            summary: [
              {
                type: "summary_text",
                text: "Then, I'll analyze the data...",
              },
            ],
          },
          {
            type: "message",
            id: "msg_789",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Here's my final answer.",
              },
            ],
          },
        ],
        status: "completed",
        usage: {
          input_tokens: 30,
          output_tokens: 60,
          total_tokens: 90,
        },
      } as Response;

      const result = fromModelResponse(response);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toHaveLength(3);

        expect(result.content[0]).toEqual({
          type: "thinking",
          text: "First, I need to understand the question...",
        });

        expect(result.content[1]).toEqual({
          type: "thinking",
          text: "Then, I'll analyze the data...",
        });

        expect(result.content[2]).toEqual({
          type: "text",
          text: "Here's my final answer.",
        });
      }
    });

    test("should handle reasoning with content text when summary is not available", () => {
      const response = {
        id: "resp_101",
        created_at: 1234567890,
        output_text: "Done.",
        error: null,
        incomplete_details: null,
        instructions: null,
        metadata: {},
        model: "o4-mini",
        object: "response",
        output: [
          {
            type: "reasoning",
            id: "rs_123",
            summary: [],
            content: [
              {
                type: "reasoning_text",
                text: "This is the full reasoning text...",
              },
            ],
          },
          {
            type: "message",
            id: "msg_101",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Done.",
              },
            ],
          },
        ],
        status: "completed",
        usage: {
          input_tokens: 15,
          output_tokens: 25,
          total_tokens: 40,
        },
      } as Response;

      const result = fromModelResponse(response);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toHaveLength(2);

        expect(result.content[0]).toEqual({
          type: "thinking",
          text: "This is the full reasoning text...",
        });

        expect(result.content[1]).toEqual({
          type: "text",
          text: "Done.",
        });
      }
    });

    test("should convert response with function calls", () => {
      const response = {
        id: "resp_call",
        created_at: 1234567890,
        output_text: "Let me search for that.",
        error: null,
        incomplete_details: null,
        instructions: null,
        metadata: {},
        model: "gpt-4o",
        object: "response",
        output: [
          {
            type: "message",
            id: "msg_call",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Let me search for that.",
              },
            ],
          },
          {
            type: "function_call",
            id: "call_123",
            name: "search",
            arguments: '{"query":"test"}',
          },
        ],
        status: "completed",
        usage: {
          input_tokens: 20,
          output_tokens: 30,
          total_tokens: 50,
        },
      } as Response;

      const result = fromModelResponse(response);

      expect(result.type).toBe("success");
      if (result.type === "success") {
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

    test("should handle error responses", () => {
      const response = {
        id: "resp_error",
        created_at: 1234567890,
        output_text: "",
        error: {
          code: "server_error",
          message: "Invalid API key provided",
        },
        incomplete_details: null,
        instructions: null,
        metadata: {},
        model: "gpt-4o",
        object: "response",
        output: [],
        status: "failed",
        usage: {
          input_tokens: 5,
          output_tokens: 0,
          total_tokens: 5,
        },
      } as Response;

      const result = fromModelResponse(response);

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error.type).toBe("server_error");
        expect(result.error.message).toBe("Invalid API key provided");
        expect(result.usage.in).toBe(5);
        expect(result.usage.out).toBe(0);
      }
    });

    test("should handle response with only reasoning and no text output", () => {
      const response = {
        id: "resp_thinking_only",
        created_at: 1234567890,
        output_text: "",
        error: null,
        incomplete_details: null,
        instructions: null,
        metadata: {},
        model: "o4-mini",
        object: "response",
        output: [
          {
            type: "reasoning",
            id: "rs_only",
            summary: [
              {
                type: "summary_text",
                text: "I need to think about this more...",
              },
            ],
          },
        ],
        status: "completed",
        usage: {
          input_tokens: 10,
          output_tokens: 15,
          total_tokens: 25,
        },
      } as Response;

      const result = fromModelResponse(response);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toHaveLength(1);
        expect(result.content[0]).toEqual({
          type: "thinking",
          text: "I need to think about this more...",
        });
      }
    });

    test("should skip reasoning items with no text", () => {
      const response = {
        id: "resp_empty_reasoning",
        created_at: 1234567890,
        output_text: "Final answer.",
        error: null,
        incomplete_details: null,
        instructions: null,
        metadata: {},
        model: "o4-mini",
        object: "response",
        output: [
          {
            type: "reasoning",
            id: "rs_empty",
            summary: [],
            content: [],
          },
          {
            type: "message",
            id: "msg_final",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Final answer.",
              },
            ],
          },
        ],
        status: "completed",
        usage: {
          input_tokens: 5,
          output_tokens: 10,
          total_tokens: 15,
        },
      } as Response;

      const result = fromModelResponse(response);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        // Should only have the text content, not the empty reasoning
        expect(result.content).toHaveLength(1);
        expect(result.content[0]).toEqual({
          type: "text",
          text: "Final answer.",
        });
      }
    });

    test("should handle encrypted reasoning content", () => {
      const response = {
        id: "resp_encrypted",
        created_at: 1234567890,
        output_text: "Answer based on encrypted reasoning.",
        error: null,
        incomplete_details: null,
        instructions: null,
        metadata: {},
        model: "o4-mini",
        object: "response",
        output: [
          {
            type: "reasoning",
            id: "rs_encrypted",
            summary: [
              {
                type: "summary_text",
                text: "Summary of my reasoning...",
              },
            ],
            encrypted_content: "encrypted_base64_string_here",
          },
          {
            type: "message",
            id: "msg_encrypted",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Answer based on encrypted reasoning.",
              },
            ],
          },
        ],
        status: "completed",
        usage: {
          input_tokens: 20,
          output_tokens: 40,
          total_tokens: 60,
        },
      } as Response;

      const result = fromModelResponse(response);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toHaveLength(2);

        expect(result.content[0]).toEqual({
          type: "thinking",
          text: "Summary of my reasoning...",
          encrypted: "encrypted_base64_string_here",
        });

        expect(result.content[1]).toEqual({
          type: "text",
          text: "Answer based on encrypted reasoning.",
        });
      }
    });
  });
});
