import type { ServerToolUseBlock } from "@anthropic-ai/sdk/resources/messages.js";
import { describe, expect, test, vi } from "vitest";
import type { AnthropicServerToolResultBlock } from "../../../src/messages/providerTool.js";
import { createAnthropicStreamingAdapter } from "../../../src/providers/anthropic/createStreamingAdapter.js";
import { AxleStopReason } from "../../../src/providers/types.js";

const directCaller = { type: "direct" } as const;

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
          container: null,
          model: "claude-3-5-sonnet-20241022",
          stop_reason: null,
          stop_sequence: null,
          stop_details: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      };

      const chunks = adapter.handleEvent(event as any);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("start");
      if (chunks[0].type === "start") {
        expect(chunks[0].id).toBe("msg_123");
        expect(chunks[0].data.model).toBe("claude-3-5-sonnet-20241022");
      }
    });

    test("should emit text-start on content_block_start for text", () => {
      const adapter = createAnthropicStreamingAdapter();

      const startChunks = adapter.handleEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" } as any,
      });

      expect(startChunks).toHaveLength(1);
      expect(startChunks[0].type).toBe("text-start");
      if (startChunks[0].type === "text-start") {
        expect(startChunks[0].data.index).toBe(0);
      }
    });

    test("should handle text content_block_delta", () => {
      const adapter = createAnthropicStreamingAdapter();

      adapter.handleEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" } as any,
      });

      const deltaChunks = adapter.handleEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello, world!" },
      });

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
        expect(chunks[0].data.usage).toEqual({ in: 0, out: 25, cachedIn: 0, cacheWriteIn: 0 });
      }
    });

    test.each([
      ["end_turn", AxleStopReason.Stop],
      ["stop_sequence", AxleStopReason.Stop],
      ["max_tokens", AxleStopReason.Length],
      ["model_context_window_exceeded", AxleStopReason.Length],
      ["tool_use", AxleStopReason.FunctionCall],
    ])("should map stop_reason %s to finish reason %s", (stopReason, finishReason) => {
      const adapter = createAnthropicStreamingAdapter();

      const chunks = adapter.handleEvent({
        type: "message_delta",
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: 25 },
      } as any);

      expect(chunks).toMatchObject([{ type: "complete", data: { finishReason } }]);
    });

    test("should fail the step on a stop_reason it does not know", () => {
      const adapter = createAnthropicStreamingAdapter();

      const chunks = adapter.handleEvent({
        type: "message_delta",
        delta: { stop_reason: "something_new", stop_sequence: null },
        usage: { output_tokens: 25 },
      } as any);

      expect(chunks).toMatchObject([
        {
          type: "error",
          data: { type: "FinishReasonError", message: "Unexpected stop reason: something_new" },
        },
      ]);
    });

    test("should include cache usage details from the streamed usage snapshot", () => {
      const adapter = createAnthropicStreamingAdapter();

      adapter.handleEvent({
        type: "message_start",
        message: {
          id: "msg_123",
          type: "message",
          role: "assistant",
          content: [],
          container: null,
          model: "claude-3-5-sonnet-20241022",
          stop_reason: null,
          stop_sequence: null,
          stop_details: null,
          usage: {
            input_tokens: 10,
            output_tokens: 0,
            cache_read_input_tokens: 30,
            cache_creation_input_tokens: 40,
          },
        },
      } as any);

      const chunks = adapter.handleEvent({
        type: "message_delta",
        delta: {
          stop_reason: "end_turn",
          stop_sequence: null,
        },
        usage: {
          output_tokens: 25,
        },
      } as any);

      expect(chunks[0].type).toBe("complete");
      if (chunks[0].type === "complete") {
        expect(chunks[0].data.usage).toEqual({
          in: 80,
          out: 25,
          cachedIn: 30,
          cacheWriteIn: 40,
        });
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
        expect(chunks[0].data).not.toHaveProperty("redacted");
        expect(chunks[0].data.continuity).toEqual({
          provider: "anthropic",
          signature: undefined,
        });
      }
    });

    test("a hidden thinking block (empty text with a signature) is not redacted", () => {
      const adapter = createAnthropicStreamingAdapter();

      const chunks = adapter.handleEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "", signature: "sig" } as any,
      });

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("thinking-start");
      if (chunks[0].type === "thinking-start") {
        expect(chunks[0].data).not.toHaveProperty("redacted");
        expect(chunks[0].data.continuity).toEqual({ provider: "anthropic", signature: "sig" });
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
        expect(chunks[0].data.continuity).toEqual({
          provider: "anthropic",
          redactedData: "",
        });
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
      expect(chunks[0].type).toBe("thinking-summary-delta");
      if (chunks[0].type === "thinking-summary-delta") {
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

      expect(delta1[0].type).toBe("thinking-summary-delta");
      expect(delta2[0].type).toBe("thinking-summary-delta");
      if (
        delta1[0].type === "thinking-summary-delta" &&
        delta2[0].type === "thinking-summary-delta"
      ) {
        expect(delta1[0].data.text).toBe("First, ");
        expect(delta2[0].data.text).toBe("I need to consider...");
      }
    });

    test("should handle signature_delta as thinking metadata", () => {
      const adapter = createAnthropicStreamingAdapter();

      const chunks = adapter.handleEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "sig_123" },
      } as any);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("thinking-metadata");
      if (chunks[0].type === "thinking-metadata") {
        expect(chunks[0].data.continuity).toEqual({
          provider: "anthropic",
          signature: "sig_123",
        });
      }
    });
  });

  describe("citations", () => {
    test("should handle citations_delta", () => {
      const adapter = createAnthropicStreamingAdapter();

      adapter.handleEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "", citations: null },
      } as any);

      const chunks = adapter.handleEvent({
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "citations_delta",
          citation: {
            type: "char_location",
            cited_text: "source text",
            document_index: 0,
            document_title: "Doc",
            start_char_index: 10,
            end_char_index: 21,
            file_id: "file_123",
          },
        },
      } as any);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("text-citation");
      if (chunks[0].type === "text-citation") {
        expect(chunks[0].data.citation).toMatchObject({
          source: {
            type: "document",
            title: "Doc",
            citedText: "source text",
            locator: { type: "char", start: 10, end: 21 },
          },
        });
      }
    });

    test("warns when citations_delta arrives outside a text block", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const adapter = createAnthropicStreamingAdapter();

      adapter.handleEvent({
        type: "content_block_delta",
        index: 1,
        delta: {
          type: "citations_delta",
          citation: {
            type: "char_location",
            cited_text: "source text",
            document_index: 0,
            document_title: "Doc",
            start_char_index: 10,
            end_char_index: 21,
            file_id: "file_123",
          },
        },
      } as any);

      expect(warn).toHaveBeenCalledWith(
        "[Anthropic] received citation delta outside a text block",
        { index: 1, blockType: undefined },
      );
      warn.mockRestore();
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
          caller: directCaller,
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
          caller: directCaller,
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

      // Each input_json_delta also surfaces as a tool-call-args-delta chunk
      // so consumers can render the model "typing" args.
      expect(delta1).toHaveLength(1);
      expect(delta1[0].type).toBe("tool-call-args-delta");
      if (delta1[0].type === "tool-call-args-delta") {
        expect(delta1[0].data.delta).toBe('{"query":');
        expect(delta1[0].data.accumulated).toBe('{"query":');
        expect(delta1[0].data.id).toBe("toolu_123");
      }

      expect(delta2).toHaveLength(1);
      expect(delta2[0].type).toBe("tool-call-args-delta");
      if (delta2[0].type === "tool-call-args-delta") {
        expect(delta2[0].data.delta).toBe('"test"}');
        expect(delta2[0].data.accumulated).toBe('{"query":"test"}');
      }
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
          caller: directCaller,
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
          caller: directCaller,
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
          caller: directCaller,
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
          caller: directCaller,
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
    test("should handle thinking followed by text with full lifecycle", () => {
      const adapter = createAnthropicStreamingAdapter();

      const thinkStart = adapter.handleEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "" } as any,
      });

      const thinkDelta = adapter.handleEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Let me think..." },
      });

      const thinkStop = adapter.handleEvent({
        type: "content_block_stop",
        index: 0,
      });

      const textStart = adapter.handleEvent({
        type: "content_block_start",
        index: 1,
        content_block: { type: "text", text: "" } as any,
      });

      const textDelta = adapter.handleEvent({
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "Here's my answer." },
      });

      expect(thinkStart[0].type).toBe("thinking-start");
      expect(thinkDelta[0].type).toBe("thinking-summary-delta");
      expect(thinkStop).toHaveLength(1);
      expect(thinkStop[0].type).toBe("thinking-complete");
      expect(textStart).toHaveLength(1);
      expect(textStart[0].type).toBe("text-start");
      expect(textDelta[0].type).toBe("text-delta");
    });

    test("should handle text followed by tool call with lifecycle events", () => {
      const adapter = createAnthropicStreamingAdapter();

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

      const textStop = adapter.handleEvent({
        type: "content_block_stop",
        index: 0,
      });

      const toolStart = adapter.handleEvent({
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "toolu_123",
          name: "search",
          input: {} as any,
          caller: directCaller,
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
      expect(textStop).toHaveLength(1);
      expect(textStop[0].type).toBe("text-complete");
      expect(toolStart[0].type).toBe("tool-call-start");
      expect(toolComplete[0].type).toBe("tool-call-complete");
    });
  });

  describe("server tools", () => {
    const callBlock = (name: ServerToolUseBlock["name"]): ServerToolUseBlock => ({
      type: "server_tool_use",
      id: "srvtoolu_123",
      name,
      input: {},
      caller: directCaller,
    });

    const searchResults: AnthropicServerToolResultBlock = {
      type: "web_search_tool_result",
      tool_use_id: "srvtoolu_123",
      caller: directCaller,
      content: [
        {
          type: "web_search_result",
          url: "https://example.com",
          title: "Example",
          encrypted_content: "enc",
          page_age: null,
        },
      ],
    };

    const call = (
      adapter: ReturnType<typeof createAnthropicStreamingAdapter>,
      name: ServerToolUseBlock["name"],
      inputJson: string,
    ) => {
      const started = adapter.handleEvent({
        type: "content_block_start",
        index: 0,
        content_block: callBlock(name),
      });
      adapter.handleEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: inputJson.slice(0, 5) },
      });
      adapter.handleEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: inputJson.slice(5) },
      });
      const closed = adapter.handleEvent({ type: "content_block_stop", index: 0 });
      return { started, closed };
    };

    test("starts a provider tool when a server_tool_use block opens", () => {
      const { started } = call(createAnthropicStreamingAdapter(), "web_search", "{}");

      expect(started).toEqual([
        { type: "provider-tool-start", data: { index: 0, id: "srvtoolu_123", name: "web_search" } },
      ]);
    });

    test("reports the search once its block closes, keeping the call block for replay", () => {
      const { closed } = call(createAnthropicStreamingAdapter(), "web_search", '{"query":"test"}');

      expect(closed).toEqual([
        {
          type: "provider-tool-input",
          data: {
            index: 0,
            id: "srvtoolu_123",
            name: "web_search",
            input: { type: "search", queries: ["test"] },
            continuity: {
              provider: "anthropic",
              call: { ...callBlock("web_search"), input: { query: "test" } },
            },
          },
        },
      ]);
    });

    test.each([
      ["web_fetch", '{"url":"https://example.com"}', { type: "open", url: "https://example.com" }],
      ["code_execution", '{"code":"print(1)"}', { type: "code", code: "print(1)" }],
      ["bash_code_execution", '{"command":"ls"}', undefined],
    ] as const)("gives %s input Axle's shape", (name, inputJson, input) => {
      const { closed } = call(createAnthropicStreamingAdapter(), name, inputJson);

      const [chunk] = closed;

      expect(chunk.type === "provider-tool-input" ? chunk.data.input : chunk.type).toEqual(input);
    });

    test("keeps an input that arrives complete on the block, with no JSON deltas", () => {
      const adapter = createAnthropicStreamingAdapter();
      const nestedSearch: ServerToolUseBlock = {
        ...callBlock("web_search"),
        input: { query: "test" },
        caller: { type: "code_execution_20260120", tool_id: "srvtoolu_code" },
      };

      adapter.handleEvent({ type: "content_block_start", index: 0, content_block: nestedSearch });
      const chunks = adapter.handleEvent({ type: "content_block_stop", index: 0 });

      expect(chunks).toEqual([
        {
          type: "provider-tool-input",
          data: {
            index: 0,
            id: "srvtoolu_123",
            name: "web_search",
            input: { type: "search", queries: ["test"] },
            continuity: { provider: "anthropic", call: nestedSearch },
          },
        },
      ]);
    });

    test("completes the tool when its result block arrives", () => {
      const adapter = createAnthropicStreamingAdapter();
      call(adapter, "web_search", '{"query":"test"}');

      const chunks = adapter.handleEvent({
        type: "content_block_start",
        index: 1,
        content_block: searchResults,
      });

      expect(chunks).toEqual([
        {
          type: "provider-tool-complete",
          data: {
            index: 0,
            id: "srvtoolu_123",
            name: "web_search",
            result: { type: "success" },
            continuity: {
              provider: "anthropic",
              call: { ...callBlock("web_search"), input: { query: "test" } },
              result: searchResults,
            },
          },
        },
      ]);
    });

    test("reports a result block that holds an error code as a failure", () => {
      const adapter = createAnthropicStreamingAdapter();
      const limitReached: AnthropicServerToolResultBlock = {
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_123",
        caller: directCaller,
        content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
      };
      call(adapter, "web_search", '{"query":"test"}');

      const chunks = adapter.handleEvent({
        type: "content_block_start",
        index: 1,
        content_block: limitReached,
      });

      expect(chunks).toHaveLength(1);
      expect(chunks[0].data).toMatchObject({
        result: {
          type: "error",
          error: { type: "max_uses_exceeded", message: "web_search failed: max_uses_exceeded" },
        },
        continuity: { provider: "anthropic", result: limitReached },
      });
    });
  });
});
