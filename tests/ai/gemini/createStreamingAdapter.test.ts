import { FinishReason } from "@google/genai";
import { describe, expect, test } from "vitest";
import { createGeminiStreamingAdapter } from "../../../src/providers/gemini/createStreamingAdapter.js";
import { AxleStopReason } from "../../../src/providers/types.js";

describe("createGeminiStreamingAdapter", () => {
  describe("basic streaming events", () => {
    test("should handle first chunk and emit start event", () => {
      const adapter = createGeminiStreamingAdapter();

      const chunk = {
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: {
              role: "model",
              parts: [],
            },
            finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 0,
          totalTokenCount: 10,
        },
      };

      const chunks = adapter.handleChunk(chunk as any);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].type).toBe("start");
      if (chunks[0].type === "start") {
        expect(chunks[0].id).toBe("resp_123");
        expect(chunks[0].data.model).toBe("gemini-2.0-flash");
      }
    });

    test("should handle text content", () => {
      const adapter = createGeminiStreamingAdapter();

      // First chunk to initialize
      adapter.handleChunk({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [] },
            finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
            index: 0,
          },
        ],
      } as any);

      // Text chunk

      const chunk = {
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "Hello, world!" }],
            },
            finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
            index: 0,
          },
        ],
      };

      const chunks = adapter.handleChunk(chunk as any);

      const textChunk = chunks.find((c) => c.type === "text-delta");
      expect(textChunk).toBeDefined();
      if (textChunk && textChunk.type === "text-delta") {
        expect(textChunk.data.text).toBe("Hello, world!");
        expect(textChunk.data.index).toBe(0);
      }
    });

    test("should handle multiple text chunks", () => {
      const adapter = createGeminiStreamingAdapter();

      // Initialize
      adapter.handleChunk({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [] },
            finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
            index: 0,
          },
        ],
      } as any);

      // First text
      const chunks1 = adapter.handleChunk({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Hello" }] },
            finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
            index: 0,
          },
        ],
      } as any);

      // Second text
      const chunks2 = adapter.handleChunk({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [{ text: ", world!" }] },
            finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
            index: 0,
          },
        ],
      } as any);

      const text1 = chunks1.find((c) => c.type === "text-delta");
      const text2 = chunks2.find((c) => c.type === "text-delta");

      expect(text1).toBeDefined();
      expect(text2).toBeDefined();
      if (text1 && text1.type === "text-delta" && text2 && text2.type === "text-delta") {
        expect(text1.data.text).toBe("Hello");
        expect(text2.data.text).toBe(", world!");
      }
    });

    test("should handle completion with STOP finish reason", () => {
      const adapter = createGeminiStreamingAdapter();

      // Initialize
      adapter.handleChunk({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [] },
            finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
            index: 0,
          },
        ],
      } as any);

      // Completion chunk

      const chunk = {
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Done" }] },
            finishReason: FinishReason.STOP,
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 20,
          totalTokenCount: 30,
        },
      };

      const chunks = adapter.handleChunk(chunk as any);

      const completeChunk = chunks.find((c) => c.type === "complete");
      expect(completeChunk).toBeDefined();
      if (completeChunk && completeChunk.type === "complete") {
        expect(completeChunk.data.finishReason).toBe(AxleStopReason.Stop);
        expect(completeChunk.data.usage.in).toBe(10);
        expect(completeChunk.data.usage.out).toBe(20);
      }
    });

    test("should handle completion with MAX_TOKENS finish reason", () => {
      const adapter = createGeminiStreamingAdapter();

      adapter.handleChunk({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [] },
            finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
            index: 0,
          },
        ],
      } as any);

      const chunk = {
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [] },
            finishReason: FinishReason.MAX_TOKENS,
            index: 0,
          },
        ],
      };

      const chunks = adapter.handleChunk(chunk as any);

      const completeChunk = chunks.find((c) => c.type === "complete");
      expect(completeChunk).toBeDefined();
      if (completeChunk && completeChunk.type === "complete") {
        expect(completeChunk.data.finishReason).toBe(AxleStopReason.Length);
      }
    });

    test("should handle error finish reasons", () => {
      const adapter = createGeminiStreamingAdapter();

      adapter.handleChunk({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [] },
            finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
            index: 0,
          },
        ],
      } as any);

      const chunk = {
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [] },
            finishReason: FinishReason.SAFETY,
            index: 0,
          },
        ],
      };

      const chunks = adapter.handleChunk(chunk as any);

      const errorChunk = chunks.find((c) => c.type === "error");
      expect(errorChunk).toBeDefined();
      if (errorChunk && errorChunk.type === "error") {
        expect(errorChunk.data.type).toBe("FinishReasonError");
        expect(errorChunk.data.message).toContain("Unexpected finish reason");
      }
    });
  });

  describe("thinking content", () => {
    test("should handle thinking content (Gemini 2.5+)", () => {
      const adapter = createGeminiStreamingAdapter();

      // Initialize
      adapter.handleChunk({
        responseId: "resp_123",
        modelVersion: "gemini-2.5-flash",
        candidates: [
          {
            content: { role: "model", parts: [] },
            finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
            index: 0,
          },
        ],
      } as any);

      // Thinking chunk

      const chunk = {
        responseId: "resp_123",
        modelVersion: "gemini-2.5-flash",
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "Let me think about this...", thought: true } as any],
            },
            finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
            index: 0,
          },
        ],
      };

      const chunks = adapter.handleChunk(chunk as any);

      const thinkingStart = chunks.find((c) => c.type === "thinking-start");
      const thinkingDelta = chunks.find((c) => c.type === "thinking-delta");

      expect(thinkingStart).toBeDefined();
      expect(thinkingDelta).toBeDefined();

      if (thinkingStart && thinkingStart.type === "thinking-start") {
        expect(thinkingStart.data.index).toBe(0);
      }
      if (thinkingDelta && thinkingDelta.type === "thinking-delta") {
        expect(thinkingDelta.data.text).toBe("Let me think about this...");
        expect(thinkingDelta.data.index).toBe(0);
      }
    });

    test("should handle multiple thinking deltas", () => {
      const adapter = createGeminiStreamingAdapter();

      adapter.handleChunk({
        responseId: "resp_123",
        modelVersion: "gemini-2.5-flash",
        candidates: [
          {
            content: { role: "model", parts: [] },
            finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
            index: 0,
          },
        ],
      } as any);

      // First thinking chunk
      const chunks1 = adapter.handleChunk({
        responseId: "resp_123",
        modelVersion: "gemini-2.5-flash",
        candidates: [
          {
            content: { role: "model", parts: [{ text: "First, ", thought: true } as any] },
            finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
            index: 0,
          },
        ],
      } as any);

      // Second thinking chunk
      const chunks2 = adapter.handleChunk({
        responseId: "resp_123",
        modelVersion: "gemini-2.5-flash",
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "I need to consider...", thought: true } as any],
            },
            finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
            index: 0,
          },
        ],
      } as any);

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

    test("should distinguish between thinking and regular text", () => {
      const adapter = createGeminiStreamingAdapter();

      adapter.handleChunk({
        responseId: "resp_123",
        modelVersion: "gemini-2.5-flash",
        candidates: [
          {
            content: { role: "model", parts: [] },
            finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
            index: 0,
          },
        ],
      } as any);

      // Thinking
      const chunks1 = adapter.handleChunk({
        responseId: "resp_123",
        modelVersion: "gemini-2.5-flash",
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Thinking...", thought: true } as any] },
            finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
            index: 0,
          },
        ],
      } as any);

      // Regular text
      const chunks2 = adapter.handleChunk({
        responseId: "resp_123",
        modelVersion: "gemini-2.5-flash",
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Here's my answer." }] },
            finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
            index: 0,
          },
        ],
      } as any);

      const thinkingDelta = chunks1.find((c) => c.type === "thinking-delta");
      const textChunk = chunks2.find((c) => c.type === "text-delta");

      expect(thinkingDelta).toBeDefined();
      expect(textChunk).toBeDefined();

      if (thinkingDelta && thinkingDelta.type === "thinking-delta") {
        expect(thinkingDelta.data.text).toBe("Thinking...");
      }
      if (textChunk && textChunk.type === "text-delta") {
        expect(textChunk.data.text).toBe("Here's my answer.");
      }
    });
  });

  describe("function call events", () => {
    test("should handle function call (buffered, not streamed)", () => {
      const adapter = createGeminiStreamingAdapter();

      // Initialize
      adapter.handleChunk({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [] },
            finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
            index: 0,
          },
        ],
      } as any);

      // Function call chunk

      const chunk = {
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: {
                    name: "search",
                    args: { query: "test" },
                  },
                },
              ],
            },
            finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
            index: 0,
          },
        ],
      };

      const chunks = adapter.handleChunk(chunk as any);

      const toolStart = chunks.find((c) => c.type === "tool-call-start");
      const toolComplete = chunks.find((c) => c.type === "tool-call-complete");

      expect(toolStart).toBeDefined();
      expect(toolComplete).toBeDefined();

      if (toolStart && toolStart.type === "tool-call-start") {
        expect(toolStart.data.name).toBe("search");
        expect(toolStart.data.index).toBe(0);
      }
      if (toolComplete && toolComplete.type === "tool-call-complete") {
        expect(toolComplete.data.name).toBe("search");
        expect(toolComplete.data.arguments).toEqual({ query: "test" });
      }
    });

    test("should handle multiple function calls", () => {
      const adapter = createGeminiStreamingAdapter();

      adapter.handleChunk({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [] },
            finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
            index: 0,
          },
        ],
      } as any);

      // Chunk with multiple function calls

      const chunk = {
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: {
                    name: "search",
                    args: { query: "test1" },
                  },
                },
                {
                  functionCall: {
                    name: "calculate",
                    args: { a: 1, b: 2 },
                  },
                },
              ],
            },
            finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
            index: 0,
          },
        ],
      };

      const chunks = adapter.handleChunk(chunk as any);

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
    test("should handle text followed by function call", () => {
      const adapter = createGeminiStreamingAdapter();

      adapter.handleChunk({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [] },
            finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
            index: 0,
          },
        ],
      } as any);

      // Text
      const chunks1 = adapter.handleChunk({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Let me search for that." }] },
            finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
            index: 0,
          },
        ],
      } as any);

      // Function call
      const chunks2 = adapter.handleChunk({
        responseId: "resp_123",
        modelVersion: "gemini-2.0-flash",
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ functionCall: { name: "search", args: { query: "test" } } }],
            },
            finishReason: FinishReason.FINISH_REASON_UNSPECIFIED,
            index: 0,
          },
        ],
      } as any);

      const textChunk = chunks1.find((c) => c.type === "text-delta");
      const toolStart = chunks2.find((c) => c.type === "tool-call-start");
      const toolComplete = chunks2.find((c) => c.type === "tool-call-complete");

      expect(textChunk).toBeDefined();
      expect(toolStart).toBeDefined();
      expect(toolComplete).toBeDefined();
    });
  });
});
