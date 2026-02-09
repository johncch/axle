import { MessageStreamEvent } from "@anthropic-ai/sdk/resources/messages.js";
import { describe, expect, test } from "vitest";
import { createAnthropicStreamingAdapter } from "../../../src/providers/anthropic/createStreamingAdapter.js";
import { AxleStopReason } from "../../../src/providers/types.js";

describe("createAnthropicStreamingAdapter", () => {
  describe("basic streaming events", () => {
    test("should handle message_start event", () => {
      const adapter = createAnthropicStreamingAdapter();
      const event = {
        type: "message_start",
        message: {
          id: "msg_123",
          type: "message",
          role: "assistant",
          content: [],
          model: "claude-3-5-sonnet-20241022",
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      } as MessageStreamEvent;

      const chunks = adapter.handleEvent(event as any);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("start");
      if (chunks[0].type === "start") {
        expect(chunks[0].id).toBe("msg_123");
        expect(chunks[0].data.model).toBe("claude-3-5-sonnet-20241022");
      }
    });

    test("should handle text content_block_start and content_block_delta", () => {
      const adapter = createAnthropicStreamingAdapter();

      // Start text block
      const startEvent: MessageStreamEvent = {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "text",
          text: "",
        } as any,
      };

      const startChunks = adapter.handleEvent(startEvent as any);
      expect(startChunks).toHaveLength(0); // No chunk emitted on text start

      // Text delta

      const deltaEvent: MessageStreamEvent = {
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "text_delta",
          text: "Hello, world!",
        },
      };

      const deltaChunks = adapter.handleEvent(deltaEvent as any);

      expect(deltaChunks).toHaveLength(1);
      expect(deltaChunks[0].type).toBe("text-delta");
      if (deltaChunks[0].type === "text-delta") {
        expect(deltaChunks[0].data.text).toBe("Hello, world!");
        expect(deltaChunks[0].data.index).toBe(0);
      }
    });

    test("should handle multiple text deltas", () => {
      const adapter = createAnthropicStreamingAdapter();

      // Start
      adapter.handleEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" } as any,
      });

      // First delta
      const delta1 = adapter.handleEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      });

      // Second delta
      const delta2 = adapter.handleEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: ", world!" },
      });

      expect(delta1[0].type).toBe("text-delta");
      expect(delta2[0].type).toBe("text-delta");
      if (delta1[0].type === "text-delta" && delta2[0].type === "text-delta") {
        expect(delta1[0].data.text).toBe("Hello");
        expect(delta2[0].data.text).toBe(", world!");
      }
    });

    test("should handle message_delta with stop_reason", () => {
      const adapter = createAnthropicStreamingAdapter();

      const event = {
        type: "message_delta",
        delta: {
          stop_reason: "end_turn",
          stop_sequence: null,
        },
        usage: {
          output_tokens: 25,
        },
      };

      const chunks = adapter.handleEvent(event as any);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("complete");
      if (chunks[0].type === "complete") {
        expect(chunks[0].data.finishReason).toBe(AxleStopReason.Stop);
        expect(chunks[0].data.usage).toEqual({ in: 0, out: 25 });
      }
    });

    test("should handle message_stop event", () => {
      const adapter = createAnthropicStreamingAdapter();

      const event = {
        type: "message_stop",
      };

      const chunks = adapter.handleEvent(event as any);

      expect(chunks).toHaveLength(0); // No action on message_stop
    });
  });

  describe("thinking content", () => {
    test("should handle thinking content_block_start", () => {
      const adapter = createAnthropicStreamingAdapter();

      const event = {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "thinking",
          thinking: "",
        } as any,
      };

      const chunks = adapter.handleEvent(event as any);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("thinking-start");
      if (chunks[0].type === "thinking-start") {
        expect(chunks[0].data.index).toBe(0);
        expect(chunks[0].data.redacted).toBe(false);
      }
    });

    test("should handle redacted_thinking content_block_start", () => {
      const adapter = createAnthropicStreamingAdapter();

      const event = {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "redacted_thinking",
          data: "",
        } as any,
      };

      const chunks = adapter.handleEvent(event as any);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("thinking-start");
      if (chunks[0].type === "thinking-start") {
        expect(chunks[0].data.index).toBe(0);
        expect(chunks[0].data.redacted).toBe(true);
      }
    });

    test("should handle thinking_delta", () => {
      const adapter = createAnthropicStreamingAdapter();

      // Start thinking block
      adapter.handleEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "" } as any,
      });

      // Thinking delta
      const event = {
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "thinking_delta",
          thinking: "Let me think about this...",
        },
      };

      const chunks = adapter.handleEvent(event as any);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("thinking-delta");
      if (chunks[0].type === "thinking-delta") {
        expect(chunks[0].data.text).toBe("Let me think about this...");
        expect(chunks[0].data.index).toBe(0);
      }
    });

    test("should handle multiple thinking deltas", () => {
      const adapter = createAnthropicStreamingAdapter();

      adapter.handleEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "" } as any,
      });

      const delta1 = adapter.handleEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "First, " },
      });

      const delta2 = adapter.handleEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "I need to consider..." },
      });

      expect(delta1[0].type).toBe("thinking-delta");
      expect(delta2[0].type).toBe("thinking-delta");
      if (delta1[0].type === "thinking-delta" && delta2[0].type === "thinking-delta") {
        expect(delta1[0].data.text).toBe("First, ");
        expect(delta2[0].data.text).toBe("I need to consider...");
      }
    });
  });

  describe("tool call events", () => {
    test("should handle tool_use content_block_start", () => {
      const adapter = createAnthropicStreamingAdapter();

      const event = {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "toolu_123",
          name: "search",
          input: {} as any,
        },
      };

      const chunks = adapter.handleEvent(event as any);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("tool-call-start");
      if (chunks[0].type === "tool-call-start") {
        expect(chunks[0].data.id).toBe("toolu_123");
        expect(chunks[0].data.name).toBe("search");
        expect(chunks[0].data.index).toBe(1);
      }
    });

    test("should accumulate tool call arguments via input_json_delta", () => {
      const adapter = createAnthropicStreamingAdapter();

      // Start tool use block
      adapter.handleEvent({
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "toolu_123",
          name: "search",
          input: {} as any,
        },
      });

      // Arguments delta 1
      const delta1 = adapter.handleEvent({
        type: "content_block_delta",
        index: 1,
        delta: {
          type: "input_json_delta",
          partial_json: '{"query":',
        },
      });

      // Arguments delta 2
      const delta2 = adapter.handleEvent({
        type: "content_block_delta",
        index: 1,
        delta: {
          type: "input_json_delta",
          partial_json: '"test"}',
        },
      });

      // Arguments are buffered but not emitted
      expect(delta1).toHaveLength(0);
      expect(delta2).toHaveLength(0);
    });

    test("should complete tool call with parsed arguments on content_block_stop", () => {
      const adapter = createAnthropicStreamingAdapter();

      // Start tool use
      adapter.handleEvent({
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "toolu_123",
          name: "search",
          input: {} as any,
        },
      });

      // Arguments deltas
      adapter.handleEvent({
        type: "content_block_delta",
        index: 1,
        delta: {
          type: "input_json_delta",
          partial_json: '{"query":"test"}',
        },
      });

      // Stop
      const event = {
        type: "content_block_stop",
        index: 1,
      };

      const chunks = adapter.handleEvent(event as any);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("tool-call-complete");
      if (chunks[0].type === "tool-call-complete") {
        expect(chunks[0].data.id).toBe("toolu_123");
        expect(chunks[0].data.name).toBe("search");
        expect(chunks[0].data.arguments).toEqual({ query: "test" });
        expect(chunks[0].data.index).toBe(1);
      }
    });

    test("should throw error when tool call arguments fail to parse", () => {
      const adapter = createAnthropicStreamingAdapter();

      // Start tool use
      adapter.handleEvent({
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "toolu_123",
          name: "search",
          input: {} as any,
        },
      });

      // Invalid JSON
      adapter.handleEvent({
        type: "content_block_delta",
        index: 1,
        delta: {
          type: "input_json_delta",
          partial_json: "{invalid json}",
        },
      });

      // Stop - should throw
      expect(() => {
        adapter.handleEvent({
          type: "content_block_stop",
          index: 1,
        });
      }).toThrow(/Failed to parse tool call arguments for search/);
    });

    test("should handle multiple tool calls", () => {
      const adapter = createAnthropicStreamingAdapter();

      // First tool call
      adapter.handleEvent({
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "toolu_1",
          name: "search",
          input: {} as any,
        },
      });

      adapter.handleEvent({
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"query":"test1"}' },
      });

      const complete1 = adapter.handleEvent({
        type: "content_block_stop",
        index: 1,
      });

      // Second tool call
      adapter.handleEvent({
        type: "content_block_start",
        index: 2,
        content_block: {
          type: "tool_use",
          id: "toolu_2",
          name: "calculate",
          input: {} as any,
        },
      });

      adapter.handleEvent({
        type: "content_block_delta",
        index: 2,
        delta: { type: "input_json_delta", partial_json: '{"a":1,"b":2}' },
      });

      const complete2 = adapter.handleEvent({
        type: "content_block_stop",
        index: 2,
      });

      expect(complete1[0].type).toBe("tool-call-complete");
      expect(complete2[0].type).toBe("tool-call-complete");

      if (complete1[0].type === "tool-call-complete") {
        expect(complete1[0].data.name).toBe("search");
        expect(complete1[0].data.arguments).toEqual({ query: "test1" });
      }
      if (complete2[0].type === "tool-call-complete") {
        expect(complete2[0].data.name).toBe("calculate");
        expect(complete2[0].data.arguments).toEqual({ a: 1, b: 2 });
      }
    });
  });

  describe("mixed content", () => {
    test("should handle thinking followed by text", () => {
      const adapter = createAnthropicStreamingAdapter();

      // Start thinking
      const thinkStart = adapter.handleEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "" } as any,
      });

      // Thinking delta
      const thinkDelta = adapter.handleEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Let me think..." },
      });

      // Stop thinking block
      const thinkStop = adapter.handleEvent({
        type: "content_block_stop",
        index: 0,
      });

      // Start text block
      const textStart = adapter.handleEvent({
        type: "content_block_start",
        index: 1,
        content_block: { type: "text", text: "" } as any,
      });

      // Text delta
      const textDelta = adapter.handleEvent({
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "Here's my answer." },
      });

      expect(thinkStart[0].type).toBe("thinking-start");
      expect(thinkDelta[0].type).toBe("thinking-delta");
      expect(thinkStop).toHaveLength(0);
      expect(textStart).toHaveLength(0);
      expect(textDelta[0].type).toBe("text-delta");
    });

    test("should handle text followed by tool call", () => {
      const adapter = createAnthropicStreamingAdapter();

      // Text
      adapter.handleEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" } as any,
      });

      const textChunk = adapter.handleEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Let me search for that." },
      });

      adapter.handleEvent({
        type: "content_block_stop",
        index: 0,
      });

      // Tool call
      const toolStart = adapter.handleEvent({
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "toolu_123",
          name: "search",
          input: {} as any,
        },
      });

      adapter.handleEvent({
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"query":"test"}' },
      });

      const toolComplete = adapter.handleEvent({
        type: "content_block_stop",
        index: 1,
      });

      expect(textChunk[0].type).toBe("text-delta");
      expect(toolStart[0].type).toBe("tool-call-start");
      expect(toolComplete[0].type).toBe("tool-call-complete");
    });
  });
});
