import OpenAI from "openai";
import { describe, expect, test } from "vitest";
import { createChatCompletionStreamingAdapter } from "../../../src/providers/openai/createChatCompletionStreamingAdapter.js";
import { AxleStopReason } from "../../../src/providers/types.js";

describe("createChatCompletionStreamingAdapter", () => {
  describe("basic streaming events", () => {
    test("should handle first chunk and emit start event", () => {
      const adapter = createChatCompletionStreamingAdapter();
      const chunk: OpenAI.Chat.Completions.ChatCompletionChunk = {
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: null,
          },
        ],
      };

      const chunks = adapter.handleChunk(chunk);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("start");
      if (chunks[0].type === "start") {
        expect(chunks[0].id).toBe("chatcmpl-123");
        expect(chunks[0].data.model).toBe("gpt-4");
      }
    });

    test("should handle text content delta", () => {
      const adapter = createChatCompletionStreamingAdapter();

      // First chunk to initialize
      adapter.handleChunk({
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [{ index: 0, delta: {}, finish_reason: null }],
      });

      // Text delta chunk
      const chunk: OpenAI.Chat.Completions.ChatCompletionChunk = {
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            delta: {
              content: "Hello, world!",
            },
            finish_reason: null,
          },
        ],
      };

      const chunks = adapter.handleChunk(chunk);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("text");
      if (chunks[0].type === "text") {
        expect(chunks[0].data.text).toBe("Hello, world!");
        expect(chunks[0].data.index).toBe(0);
      }
    });

    test("should handle multiple text deltas", () => {
      const adapter = createChatCompletionStreamingAdapter();

      // Initialize
      adapter.handleChunk({
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [{ index: 0, delta: {}, finish_reason: null }],
      });

      // First text
      const chunks1 = adapter.handleChunk({
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
      });

      // Second text
      const chunks2 = adapter.handleChunk({
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [{ index: 0, delta: { content: ", world!" }, finish_reason: null }],
      });

      expect(chunks1[0].type).toBe("text");
      expect(chunks2[0].type).toBe("text");
      if (chunks1[0].type === "text" && chunks2[0].type === "text") {
        expect(chunks1[0].data.text).toBe("Hello");
        expect(chunks2[0].data.text).toBe(", world!");
      }
    });

    test("should handle completion with stop finish reason", () => {
      const adapter = createChatCompletionStreamingAdapter();

      // Initialize
      adapter.handleChunk({
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [{ index: 0, delta: {}, finish_reason: null }],
      });

      // Completion chunk
      const chunk: OpenAI.Chat.Completions.ChatCompletionChunk = {
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      };

      const chunks = adapter.handleChunk(chunk);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("complete");
      if (chunks[0].type === "complete") {
        expect(chunks[0].data.finishReason).toBe(AxleStopReason.Stop);
        expect(chunks[0].data.usage.in).toBe(10);
        expect(chunks[0].data.usage.out).toBe(20);
      }
    });

    test("should handle completion with length finish reason", () => {
      const adapter = createChatCompletionStreamingAdapter();

      adapter.handleChunk({
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [{ index: 0, delta: {}, finish_reason: null }],
      });

      const chunk: OpenAI.Chat.Completions.ChatCompletionChunk = {
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "length",
          },
        ],
      };

      const chunks = adapter.handleChunk(chunk);

      expect(chunks[0].type).toBe("complete");
      if (chunks[0].type === "complete") {
        expect(chunks[0].data.finishReason).toBe(AxleStopReason.Length);
      }
    });
  });

  describe("tool call events", () => {
    test("should handle tool call start", () => {
      const adapter = createChatCompletionStreamingAdapter();

      // Initialize
      adapter.handleChunk({
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [{ index: 0, delta: {}, finish_reason: null }],
      });

      // Tool call start
      const chunk: OpenAI.Chat.Completions.ChatCompletionChunk = {
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_123",
                  type: "function",
                  function: {
                    name: "search",
                    arguments: "",
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      };

      const chunks = adapter.handleChunk(chunk);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("tool-call-start");
      if (chunks[0].type === "tool-call-start") {
        expect(chunks[0].data.id).toBe("call_123");
        expect(chunks[0].data.name).toBe("search");
        expect(chunks[0].data.index).toBe(1);
      }
    });

    test("should accumulate tool call arguments", () => {
      const adapter = createChatCompletionStreamingAdapter();

      // Initialize
      adapter.handleChunk({
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [{ index: 0, delta: {}, finish_reason: null }],
      });

      // Tool call start
      adapter.handleChunk({
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_123",
                  type: "function",
                  function: { name: "search", arguments: "" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });

      // Arguments delta 1
      adapter.handleChunk({
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  type: "function",
                  function: { arguments: '{"query":' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });

      // Arguments delta 2
      const chunks = adapter.handleChunk({
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  type: "function",
                  function: { arguments: '"test"}' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });

      // Arguments are accumulated but not emitted until completion
      expect(chunks).toHaveLength(0);
    });

    test("should complete tool call with parsed arguments", () => {
      const adapter = createChatCompletionStreamingAdapter();

      // Initialize
      adapter.handleChunk({
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [{ index: 0, delta: {}, finish_reason: null }],
      });

      // Tool call with arguments
      adapter.handleChunk({
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_123",
                  type: "function",
                  function: { name: "search", arguments: '{"query":"test"}' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });

      // Finish with tool_calls reason
      const chunk: OpenAI.Chat.Completions.ChatCompletionChunk = {
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "tool_calls",
          },
        ],
      };

      const chunks = adapter.handleChunk(chunk);

      expect(chunks).toHaveLength(2);
      expect(chunks[0].type).toBe("tool-call-complete");
      if (chunks[0].type === "tool-call-complete") {
        expect(chunks[0].data.id).toBe("call_123");
        expect(chunks[0].data.name).toBe("search");
        expect(chunks[0].data.arguments).toEqual({ query: "test" });
      }
      expect(chunks[1].type).toBe("complete");
      if (chunks[1].type === "complete") {
        expect(chunks[1].data.finishReason).toBe(AxleStopReason.FunctionCall);
      }
    });

    test("should throw error when tool call arguments fail to parse", () => {
      const adapter = createChatCompletionStreamingAdapter();

      // Initialize
      adapter.handleChunk({
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [{ index: 0, delta: {}, finish_reason: null }],
      });

      // Tool call with invalid JSON
      adapter.handleChunk({
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_123",
                  type: "function",
                  function: { name: "search", arguments: "{invalid json}" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });

      // Finish - should throw when trying to parse
      const chunk: OpenAI.Chat.Completions.ChatCompletionChunk = {
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      };

      expect(() => adapter.handleChunk(chunk)).toThrow(
        /Failed to parse tool call arguments for search/,
      );
    });

    test("should handle multiple tool calls", () => {
      const adapter = createChatCompletionStreamingAdapter();

      // Initialize
      adapter.handleChunk({
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [{ index: 0, delta: {}, finish_reason: null }],
      });

      // First tool call
      adapter.handleChunk({
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "search", arguments: '{"query":"test1"}' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });

      // Second tool call
      adapter.handleChunk({
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 1,
                  id: "call_2",
                  type: "function",
                  function: { name: "calculate", arguments: '{"a":1,"b":2}' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });

      // Finish
      const chunks = adapter.handleChunk({
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      });

      expect(chunks).toHaveLength(3);
      expect(chunks[0].type).toBe("tool-call-complete");
      expect(chunks[1].type).toBe("tool-call-complete");
      expect(chunks[2].type).toBe("complete");

      if (chunks[0].type === "tool-call-complete") {
        expect(chunks[0].data.name).toBe("search");
        expect(chunks[0].data.arguments).toEqual({ query: "test1" });
      }
      if (chunks[1].type === "tool-call-complete") {
        expect(chunks[1].data.name).toBe("calculate");
        expect(chunks[1].data.arguments).toEqual({ a: 1, b: 2 });
      }
    });
  });

  describe("mixed content", () => {
    test("should handle text followed by tool call", () => {
      const adapter = createChatCompletionStreamingAdapter();

      // Initialize
      const startChunks = adapter.handleChunk({
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [{ index: 0, delta: {}, finish_reason: null }],
      });

      // Text
      const textChunks = adapter.handleChunk({
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [{ index: 0, delta: { content: "Let me search for that." }, finish_reason: null }],
      });

      // Tool call
      const toolStartChunks = adapter.handleChunk({
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_123",
                  type: "function",
                  function: { name: "search", arguments: '{"query":"test"}' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });

      // Finish
      const completeChunks = adapter.handleChunk({
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      });

      expect(startChunks[0].type).toBe("start");
      expect(textChunks[0].type).toBe("text");
      expect(toolStartChunks[0].type).toBe("tool-call-start");
      expect(completeChunks[0].type).toBe("tool-call-complete");
      expect(completeChunks[1].type).toBe("complete");
    });
  });
});
