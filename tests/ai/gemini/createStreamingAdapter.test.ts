import { FinishReason } from "@google/genai";
import { describe, expect, test } from "vitest";
import { createGeminiStreamingAdapter } from "../../../src/providers/gemini/createStreamingAdapter.js";
import { AxleStopReason } from "../../../src/providers/types.js";

describe("createGeminiStreamingAdapter", () => {
  describe("basic streaming events", () => {
    test("should handle first chunk and emit start event", () => {
      const adapter = createGeminiStreamingAdapter();
      const chunks = adapter.handleChunk(makeChunk({ parts: [] }));

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].type).toBe("start");
      if (chunks[0].type === "start") {
        expect(chunks[0].id).toBe("resp_123");
        expect(chunks[0].data.model).toBe("gemini-2.0-flash");
      }
    });

    test("should emit text-start before first text-delta", () => {
      const adapter = createGeminiStreamingAdapter();
      const chunks = adapter.handleChunk(makeChunk({ parts: [{ text: "Hello, world!" }] }));

      const types = chunks.map((c) => c.type);
      expect(types).toContain("text-start");
      expect(types).toContain("text-delta");
      expect(types.indexOf("text-start")).toBeLessThan(types.indexOf("text-delta"));

      const textDelta = chunks.find((c) => c.type === "text-delta");
      if (textDelta && textDelta.type === "text-delta") {
        expect(textDelta.data.text).toBe("Hello, world!");
        expect(textDelta.data.index).toBe(0);
      }
    });

    test("should not emit text-start on subsequent text chunks", () => {
      const adapter = createGeminiStreamingAdapter();
      adapter.handleChunk(makeChunk({ parts: [{ text: "Hello" }] }));
      const chunks = adapter.handleChunk(makeChunk({ parts: [{ text: ", world!" }] }));

      const types = chunks.map((c) => c.type);
      expect(types).not.toContain("text-start");
      expect(types).toContain("text-delta");

      const textDelta = chunks.find((c) => c.type === "text-delta");
      if (textDelta && textDelta.type === "text-delta") {
        expect(textDelta.data.text).toBe(", world!");
      }
    });

    test("should emit text-complete before complete on finish", () => {
      const adapter = createGeminiStreamingAdapter();
      adapter.handleChunk(makeChunk({ parts: [{ text: "Hi" }] }));

      const chunks = adapter.handleChunk(
        makeChunk({ parts: [{ text: "Done" }], finishReason: FinishReason.STOP, usage: { promptTokenCount: 10, totalTokenCount: 30 } }),
      );

      const types = chunks.map((c) => c.type);
      expect(types).toContain("text-complete");
      expect(types).toContain("complete");
      expect(types.indexOf("text-complete")).toBeLessThan(types.indexOf("complete"));

      const completeChunk = chunks.find((c) => c.type === "complete");
      if (completeChunk && completeChunk.type === "complete") {
        expect(completeChunk.data.finishReason).toBe(AxleStopReason.Stop);
        expect(completeChunk.data.usage.in).toBe(10);
        expect(completeChunk.data.usage.out).toBe(20);
      }
    });

    test("should handle completion with MAX_TOKENS finish reason", () => {
      const adapter = createGeminiStreamingAdapter();
      adapter.handleChunk(makeChunk({ parts: [{ text: "Hi" }] }));

      const chunks = adapter.handleChunk(
        makeChunk({ parts: [], finishReason: FinishReason.MAX_TOKENS }),
      );

      const completeChunk = chunks.find((c) => c.type === "complete");
      expect(completeChunk).toBeDefined();
      if (completeChunk && completeChunk.type === "complete") {
        expect(completeChunk.data.finishReason).toBe(AxleStopReason.Length);
      }
    });

    test("should handle error finish reasons", () => {
      const adapter = createGeminiStreamingAdapter();
      adapter.handleChunk(makeChunk({ parts: [] }));

      const chunks = adapter.handleChunk(
        makeChunk({ parts: [], finishReason: FinishReason.SAFETY }),
      );

      const errorChunk = chunks.find((c) => c.type === "error");
      expect(errorChunk).toBeDefined();
      if (errorChunk && errorChunk.type === "error") {
        expect(errorChunk.data.type).toBe("FinishReasonError");
        expect(errorChunk.data.message).toContain("Unexpected finish reason");
      }
    });
  });

  describe("thinking content", () => {
    test("should emit thinking-start before first thinking-delta", () => {
      const adapter = createGeminiStreamingAdapter();
      const chunks = adapter.handleChunk(
        makeChunk({ parts: [{ text: "Let me think about this...", thought: true }] }),
      );

      const types = chunks.map((c) => c.type);
      expect(types).toContain("thinking-start");
      expect(types).toContain("thinking-delta");
      expect(types.indexOf("thinking-start")).toBeLessThan(types.indexOf("thinking-delta"));

      const thinkingDelta = chunks.find((c) => c.type === "thinking-delta");
      if (thinkingDelta && thinkingDelta.type === "thinking-delta") {
        expect(thinkingDelta.data.text).toBe("Let me think about this...");
        expect(thinkingDelta.data.index).toBe(0);
      }
    });

    test("should not emit thinking-start on subsequent thinking chunks", () => {
      const adapter = createGeminiStreamingAdapter();
      adapter.handleChunk(makeChunk({ parts: [{ text: "First, ", thought: true }] }));
      const chunks = adapter.handleChunk(
        makeChunk({ parts: [{ text: "I need to consider...", thought: true }] }),
      );

      const types = chunks.map((c) => c.type);
      expect(types).not.toContain("thinking-start");
      expect(types).toContain("thinking-delta");

      const delta = chunks.find((c) => c.type === "thinking-delta");
      if (delta && delta.type === "thinking-delta") {
        expect(delta.data.text).toBe("I need to consider...");
      }
    });

    test("thinking followed by text produces correct lifecycle", () => {
      const adapter = createGeminiStreamingAdapter();
      const chunk1 = adapter.handleChunk(
        makeChunk({ parts: [{ text: "Thinking...", thought: true }] }),
      );
      const chunk2 = adapter.handleChunk(
        makeChunk({ parts: [{ text: "Here's my answer." }] }),
      );

      const allChunks = [...chunk1, ...chunk2];
      const types = allChunks.map((c) => c.type);

      expect(types).toContain("thinking-start");
      expect(types).toContain("thinking-delta");
      expect(types).toContain("thinking-complete");
      expect(types).toContain("text-start");
      expect(types).toContain("text-delta");

      const thinkingCompleteIdx = types.indexOf("thinking-complete");
      const textStartIdx = types.indexOf("text-start");
      expect(thinkingCompleteIdx).toBeLessThan(textStartIdx);
    });

    test("should emit thinking-complete on finish without text", () => {
      const adapter = createGeminiStreamingAdapter();
      adapter.handleChunk(makeChunk({ parts: [{ text: "Thinking...", thought: true }] }));
      const chunks = adapter.handleChunk(
        makeChunk({ parts: [], finishReason: FinishReason.STOP }),
      );

      const types = chunks.map((c) => c.type);
      expect(types).toContain("thinking-complete");
      expect(types.indexOf("thinking-complete")).toBeLessThan(types.indexOf("complete"));
    });
  });

  describe("function call events", () => {
    test("should handle function call (buffered, not streamed)", () => {
      const adapter = createGeminiStreamingAdapter();
      const chunks = adapter.handleChunk(
        makeChunk({
          parts: [{ functionCall: { name: "search", args: { query: "test" } } }],
        }),
      );

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
      const chunks = adapter.handleChunk(
        makeChunk({
          parts: [
            { functionCall: { name: "search", args: { query: "test1" } } },
            { functionCall: { name: "calculate", args: { a: 1, b: 2 } } },
          ],
        }),
      );

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

    test("should close active text before function calls", () => {
      const adapter = createGeminiStreamingAdapter();
      adapter.handleChunk(makeChunk({ parts: [{ text: "Let me search" }] }));
      const chunks = adapter.handleChunk(
        makeChunk({
          parts: [{ functionCall: { name: "search", args: { query: "test" } } }],
        }),
      );

      const types = chunks.map((c) => c.type);
      expect(types).toContain("text-complete");
      expect(types.indexOf("text-complete")).toBeLessThan(types.indexOf("tool-call-start"));
    });

    test("should use functionCall.id when available", () => {
      const adapter = createGeminiStreamingAdapter();
      const chunks = adapter.handleChunk(
        makeChunk({
          parts: [{ functionCall: { id: "fc_abc", name: "search", args: {} } }],
        }),
      );

      const toolStart = chunks.find((c) => c.type === "tool-call-start");
      if (toolStart && toolStart.type === "tool-call-start") {
        expect(toolStart.data.id).toBe("fc_abc");
      }
    });
  });

  describe("mixed content", () => {
    test("should handle text followed by function call with correct lifecycle", () => {
      const adapter = createGeminiStreamingAdapter();
      const chunk1 = adapter.handleChunk(makeChunk({ parts: [{ text: "Let me search for that." }] }));
      const chunk2 = adapter.handleChunk(
        makeChunk({
          parts: [{ functionCall: { name: "search", args: { query: "test" } } }],
        }),
      );

      const allChunks = [...chunk1, ...chunk2];
      const types = allChunks.map((c) => c.type);

      expect(types).toContain("text-start");
      expect(types).toContain("text-delta");
      expect(types).toContain("text-complete");
      expect(types).toContain("tool-call-start");
      expect(types).toContain("tool-call-complete");

      expect(types.indexOf("text-complete")).toBeLessThan(types.indexOf("tool-call-start"));
    });

    test("function call with STOP sets finishReason to FunctionCall", () => {
      const adapter = createGeminiStreamingAdapter();
      const chunks = adapter.handleChunk(
        makeChunk({
          parts: [{ functionCall: { name: "search", args: {} } }],
          finishReason: FinishReason.STOP,
        }),
      );

      const complete = chunks.find((c) => c.type === "complete");
      if (complete && complete.type === "complete") {
        expect(complete.data.finishReason).toBe(AxleStopReason.FunctionCall);
      }
    });
  });
});

// Helpers

function makeChunk(options: {
  parts: any[];
  finishReason?: FinishReason;
  usage?: { promptTokenCount?: number; totalTokenCount?: number };
}) {
  return {
    responseId: "resp_123",
    modelVersion: "gemini-2.0-flash",
    candidates: [
      {
        content: { role: "model", parts: options.parts },
        finishReason: options.finishReason ?? FinishReason.FINISH_REASON_UNSPECIFIED,
        index: 0,
      },
    ],
    ...(options.usage && { usageMetadata: options.usage }),
  } as any;
}
