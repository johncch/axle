import { describe, expect, test } from "vitest";
import { createOllamaStreamingAdapter } from "../../../src/ai/ollama/createStreamingAdapter.js";
import { AxleStopReason } from "../../../src/ai/types.js";

interface OllamaStreamChunk {
  model: string;
  created_at: string;
  message?: {
    role: string;
    content: string;
    thinking?: string;
    tool_calls?: Array<{
      id?: string;
      function: {
        name: string;
        arguments: unknown;
      };
    }>;
  };
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

describe("createOllamaStreamingAdapter", () => {
  describe("basic streaming events", () => {
    test("should handle first chunk and emit start event", () => {
      const adapter = createOllamaStreamingAdapter();
      const chunk: OllamaStreamChunk = {
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: {
          role: "assistant",
          content: "",
        },
        done: false,
      };

      const chunks = adapter.handleChunk(chunk);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("start");
      if (chunks[0].type === "start") {
        expect(chunks[0].data.model).toBe("llama3.2");
      }
    });

    test("should handle text content", () => {
      const adapter = createOllamaStreamingAdapter();

      // Initialize
      adapter.handleChunk({
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: { role: "assistant", content: "" },
        done: false,
      });

      // Text chunk
      const chunk: OllamaStreamChunk = {
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: {
          role: "assistant",
          content: "Hello, world!",
        },
        done: false,
      };

      const chunks = adapter.handleChunk(chunk);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("text");
      if (chunks[0].type === "text") {
        expect(chunks[0].data.text).toBe("Hello, world!");
        expect(chunks[0].data.index).toBe(0);
      }
    });

    test("should handle multiple text chunks", () => {
      const adapter = createOllamaStreamingAdapter();

      // Initialize
      adapter.handleChunk({
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: { role: "assistant", content: "" },
        done: false,
      });

      // First text
      const chunks1 = adapter.handleChunk({
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: { role: "assistant", content: "Hello" },
        done: false,
      });

      // Second text
      const chunks2 = adapter.handleChunk({
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: { role: "assistant", content: ", world!" },
        done: false,
      });

      expect(chunks1[0].type).toBe("text");
      expect(chunks2[0].type).toBe("text");
      if (chunks1[0].type === "text" && chunks2[0].type === "text") {
        expect(chunks1[0].data.text).toBe("Hello");
        expect(chunks2[0].data.text).toBe(", world!");
      }
    });

    test("should handle completion with stop reason", () => {
      const adapter = createOllamaStreamingAdapter();

      // Initialize
      adapter.handleChunk({
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: { role: "assistant", content: "" },
        done: false,
      });

      // Completion chunk
      const chunk: OllamaStreamChunk = {
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: {
          role: "assistant",
          content: "Done",
        },
        done: true,
        done_reason: "stop",
        prompt_eval_count: 10,
        eval_count: 20,
      };

      const chunks = adapter.handleChunk(chunk);

      const completeChunk = chunks.find((c) => c.type === "complete");
      expect(completeChunk).toBeDefined();
      if (completeChunk && completeChunk.type === "complete") {
        expect(completeChunk.data.finishReason).toBe(AxleStopReason.Stop);
        expect(completeChunk.data.usage.in).toBe(10);
        expect(completeChunk.data.usage.out).toBe(20);
      }
    });

    test("should handle completion with length reason", () => {
      const adapter = createOllamaStreamingAdapter();

      adapter.handleChunk({
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: { role: "assistant", content: "" },
        done: false,
      });

      const chunk: OllamaStreamChunk = {
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: { role: "assistant", content: "" },
        done: true,
        done_reason: "length",
      };

      const chunks = adapter.handleChunk(chunk);

      const completeChunk = chunks.find((c) => c.type === "complete");
      expect(completeChunk).toBeDefined();
      if (completeChunk && completeChunk.type === "complete") {
        expect(completeChunk.data.finishReason).toBe(AxleStopReason.Length);
      }
    });
  });

  describe("thinking content", () => {
    test("should handle thinking content", () => {
      const adapter = createOllamaStreamingAdapter();

      // Initialize
      adapter.handleChunk({
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: { role: "assistant", content: "" },
        done: false,
      });

      // Thinking chunk
      const chunk: OllamaStreamChunk = {
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: {
          role: "assistant",
          content: "",
          thinking: "Let me think about this...",
        },
        done: false,
      };

      const chunks = adapter.handleChunk(chunk);

      const thinkingStart = chunks.find((c) => c.type === "thinking-start");
      const thinkingDelta = chunks.find((c) => c.type === "thinking-delta");

      expect(thinkingStart).toBeDefined();
      expect(thinkingDelta).toBeDefined();

      if (thinkingStart && thinkingStart.type === "thinking-start") {
        expect(thinkingStart.data.index).toBe(1);
      }
      if (thinkingDelta && thinkingDelta.type === "thinking-delta") {
        expect(thinkingDelta.data.text).toBe("Let me think about this...");
        expect(thinkingDelta.data.index).toBe(1);
      }
    });

    test("should handle multiple thinking deltas", () => {
      const adapter = createOllamaStreamingAdapter();

      adapter.handleChunk({
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: { role: "assistant", content: "" },
        done: false,
      });

      // First thinking
      const chunks1 = adapter.handleChunk({
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: { role: "assistant", content: "", thinking: "First, " },
        done: false,
      });

      // Second thinking
      const chunks2 = adapter.handleChunk({
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: { role: "assistant", content: "", thinking: "I need to consider..." },
        done: false,
      });

      const delta1 = chunks1.find((c) => c.type === "thinking-delta");
      const delta2 = chunks2.find((c) => c.type === "thinking-delta");

      expect(delta1).toBeDefined();
      expect(delta2).toBeDefined();

      if (
        delta1 &&
        delta1.type === "thinking-delta" &&
        delta2 &&
        delta2.type === "thinking-delta"
      ) {
        expect(delta1.data.text).toBe("First, ");
        expect(delta2.data.text).toBe("I need to consider...");
      }
    });

    test("should handle thinking followed by text", () => {
      const adapter = createOllamaStreamingAdapter();

      adapter.handleChunk({
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: { role: "assistant", content: "" },
        done: false,
      });

      // Thinking
      const chunks1 = adapter.handleChunk({
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: { role: "assistant", content: "", thinking: "Thinking..." },
        done: false,
      });

      // Text
      const chunks2 = adapter.handleChunk({
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: { role: "assistant", content: "Here's my answer." },
        done: false,
      });

      const thinkingDelta = chunks1.find((c) => c.type === "thinking-delta");
      const textChunk = chunks2.find((c) => c.type === "text");

      expect(thinkingDelta).toBeDefined();
      expect(textChunk).toBeDefined();
    });
  });

  describe("tool call events", () => {
    test("should handle tool call (complete, not streamed)", () => {
      const adapter = createOllamaStreamingAdapter();

      // Initialize
      adapter.handleChunk({
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: { role: "assistant", content: "" },
        done: false,
      });

      // Tool call chunk (Ollama sends complete tool calls)
      const chunk: OllamaStreamChunk = {
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: {
          role: "assistant",
          content: "",
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
        done: false,
      };

      const chunks = adapter.handleChunk(chunk);

      const toolStart = chunks.find((c) => c.type === "tool-call-start");
      const toolComplete = chunks.find((c) => c.type === "tool-call-complete");

      expect(toolStart).toBeDefined();
      expect(toolComplete).toBeDefined();

      if (toolStart && toolStart.type === "tool-call-start") {
        expect(toolStart.data.id).toBe("call_123");
        expect(toolStart.data.name).toBe("search");
      }
      if (toolComplete && toolComplete.type === "tool-call-complete") {
        expect(toolComplete.data.name).toBe("search");
        expect(toolComplete.data.arguments).toEqual({ query: "test" });
      }
    });

    test("should generate ID for tool call without ID", () => {
      const adapter = createOllamaStreamingAdapter();

      adapter.handleChunk({
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: { role: "assistant", content: "" },
        done: false,
      });

      const chunk: OllamaStreamChunk = {
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              function: {
                name: "search",
                arguments: { query: "test" },
              },
            },
          ],
        },
        done: false,
      };

      const chunks = adapter.handleChunk(chunk);

      const toolStart = chunks.find((c) => c.type === "tool-call-start");
      expect(toolStart).toBeDefined();
      if (toolStart && toolStart.type === "tool-call-start") {
        expect(toolStart.data.id).toBe("tool-1");
      }
    });

    test("should throw error when tool call arguments are invalid", () => {
      const adapter = createOllamaStreamingAdapter();

      adapter.handleChunk({
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: { role: "assistant", content: "" },
        done: false,
      });

      const chunk: OllamaStreamChunk = {
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_123",
              function: {
                name: "search",
                arguments: "invalid", // String instead of object
              },
            },
          ],
        },
        done: false,
      };

      expect(() => adapter.handleChunk(chunk)).toThrow(/Invalid tool call arguments for search/);
    });

    test("should handle multiple tool calls", () => {
      const adapter = createOllamaStreamingAdapter();

      adapter.handleChunk({
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: { role: "assistant", content: "" },
        done: false,
      });

      const chunk: OllamaStreamChunk = {
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_1",
              function: { name: "search", arguments: { query: "test1" } },
            },
            {
              id: "call_2",
              function: { name: "calculate", arguments: { a: 1, b: 2 } },
            },
          ],
        },
        done: false,
      };

      const chunks = adapter.handleChunk(chunk);

      const toolCompletes = chunks.filter((c) => c.type === "tool-call-complete");
      expect(toolCompletes).toHaveLength(2);

      if (toolCompletes[0].type === "tool-call-complete") {
        expect(toolCompletes[0].data.name).toBe("search");
        expect(toolCompletes[0].data.arguments).toEqual({ query: "test1" });
      }
      if (toolCompletes[1].type === "tool-call-complete") {
        expect(toolCompletes[1].data.name).toBe("calculate");
        expect(toolCompletes[1].data.arguments).toEqual({ a: 1, b: 2 });
      }
    });
  });

  describe("mixed content", () => {
    test("should handle text followed by tool call", () => {
      const adapter = createOllamaStreamingAdapter();

      adapter.handleChunk({
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: { role: "assistant", content: "" },
        done: false,
      });

      // Text
      const chunks1 = adapter.handleChunk({
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: { role: "assistant", content: "Let me search for that." },
        done: false,
      });

      // Tool call
      const chunks2 = adapter.handleChunk({
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_123",
              function: { name: "search", arguments: { query: "test" } },
            },
          ],
        },
        done: false,
      });

      const textChunk = chunks1.find((c) => c.type === "text");
      const toolStart = chunks2.find((c) => c.type === "tool-call-start");
      const toolComplete = chunks2.find((c) => c.type === "tool-call-complete");

      expect(textChunk).toBeDefined();
      expect(toolStart).toBeDefined();
      expect(toolComplete).toBeDefined();
    });

    test("should handle thinking followed by text and tool call", () => {
      const adapter = createOllamaStreamingAdapter();

      adapter.handleChunk({
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: { role: "assistant", content: "" },
        done: false,
      });

      // Thinking
      const chunks1 = adapter.handleChunk({
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: { role: "assistant", content: "", thinking: "I should search..." },
        done: false,
      });

      // Text
      const chunks2 = adapter.handleChunk({
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: { role: "assistant", content: "Searching now." },
        done: false,
      });

      // Tool call
      const chunks3 = adapter.handleChunk({
        model: "llama3.2",
        created_at: "2024-01-01T00:00:00Z",
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              function: { name: "search", arguments: { query: "test" } },
            },
          ],
        },
        done: false,
      });

      expect(chunks1.find((c) => c.type === "thinking-delta")).toBeDefined();
      expect(chunks2.find((c) => c.type === "text")).toBeDefined();
      expect(chunks3.find((c) => c.type === "tool-call-complete")).toBeDefined();
    });
  });
});
