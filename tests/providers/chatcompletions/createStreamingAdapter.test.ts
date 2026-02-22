import { describe, expect, test } from "vitest";
import { createStreamingAdapter } from "../../../src/providers/chatcompletions/createStreamingAdapter.js";
import { ChatCompletionChunk } from "../../../src/providers/chatcompletions/types.js";
import { AxleStopReason } from "../../../src/providers/types.js";

describe("createStreamingAdapter", () => {
  describe("start event", () => {
    test("emits start on first chunk", () => {
      const adapter = createStreamingAdapter();
      const chunks = adapter.handleChunk(makeChunk({ content: "Hi" }));

      expect(chunks[0].type).toBe("start");
      expect(chunks[0].id).toBe("chatcmpl-1");
      expect((chunks[0] as any).data.model).toBe("test-model");
    });

    test("does not emit start on subsequent chunks", () => {
      const adapter = createStreamingAdapter();
      adapter.handleChunk(makeChunk({ content: "Hi" }));
      const chunks = adapter.handleChunk(makeChunk({ content: " there" }));

      const startChunks = chunks.filter((c) => c.type === "start");
      expect(startChunks).toHaveLength(0);
    });
  });

  describe("text content", () => {
    test("emits text-start before first text-delta", () => {
      const adapter = createStreamingAdapter();
      const chunks = adapter.handleChunk(makeChunk({ content: "Hello" }));

      const types = chunks.map((c) => c.type);
      expect(types).toContain("text-start");
      expect(types).toContain("text-delta");
      expect(types.indexOf("text-start")).toBeLessThan(types.indexOf("text-delta"));
    });

    test("emits text-delta without text-start on subsequent chunks", () => {
      const adapter = createStreamingAdapter();
      adapter.handleChunk(makeChunk({ content: "Hello" }));
      const chunks = adapter.handleChunk(makeChunk({ content: " world" }));

      const types = chunks.map((c) => c.type);
      expect(types).not.toContain("text-start");
      expect(types).toContain("text-delta");
      expect((chunks.find((c) => c.type === "text-delta") as any).data.text).toBe(" world");
    });

    test("emits text-complete on finish", () => {
      const adapter = createStreamingAdapter();
      adapter.handleChunk(makeChunk({ content: "Hi" }));
      const chunks = adapter.handleChunk(makeChunk({}, "stop"));
      const final = adapter.finalize();
      const all = [...chunks, ...final];

      const types = all.map((c) => c.type);
      expect(types).toContain("text-complete");
      expect(types.indexOf("text-complete")).toBeLessThan(types.indexOf("complete"));
    });
  });

  describe("reasoning content", () => {
    test("emits thinking-start on first reasoning_content", () => {
      const adapter = createStreamingAdapter();
      const chunks = adapter.handleChunk(makeChunk({ reasoning_content: "Let me think..." }));

      const thinkingStart = chunks.filter((c) => c.type === "thinking-start");
      expect(thinkingStart).toHaveLength(1);
    });

    test("emits thinking-delta for reasoning_content", () => {
      const adapter = createStreamingAdapter();
      const chunks = adapter.handleChunk(makeChunk({ reasoning_content: "Step 1" }));

      const thinkingDeltas = chunks.filter((c) => c.type === "thinking-delta");
      expect(thinkingDeltas).toHaveLength(1);
      expect((thinkingDeltas[0] as any).data.text).toBe("Step 1");
    });

    test("does not emit thinking-start for subsequent reasoning chunks", () => {
      const adapter = createStreamingAdapter();
      adapter.handleChunk(makeChunk({ reasoning_content: "Step 1" }));
      const chunks = adapter.handleChunk(makeChunk({ reasoning_content: " Step 2" }));

      const thinkingStarts = chunks.filter((c) => c.type === "thinking-start");
      expect(thinkingStarts).toHaveLength(0);

      const thinkingDeltas = chunks.filter((c) => c.type === "thinking-delta");
      expect(thinkingDeltas).toHaveLength(1);
      expect((thinkingDeltas[0] as any).data.text).toBe(" Step 2");
    });

    test("reasoning followed by text produces correct lifecycle", () => {
      const adapter = createStreamingAdapter();

      const chunk1 = adapter.handleChunk(makeChunk({ reasoning_content: "Thinking..." }));
      const chunk2 = adapter.handleChunk(makeChunk({ content: "Answer" }));

      const allChunks = [...chunk1, ...chunk2];
      const types = allChunks.map((c) => c.type);

      // Should have: start, thinking-start, thinking-delta, thinking-complete, text-start, text-delta
      expect(types).toContain("thinking-start");
      expect(types).toContain("thinking-delta");
      expect(types).toContain("thinking-complete");
      expect(types).toContain("text-start");
      expect(types).toContain("text-delta");

      const thinkingCompleteIdx = types.indexOf("thinking-complete");
      const textStartIdx = types.indexOf("text-start");
      expect(thinkingCompleteIdx).toBeLessThan(textStartIdx);
    });

    test("emits thinking-complete on finish without text", () => {
      const adapter = createStreamingAdapter();
      adapter.handleChunk(makeChunk({ reasoning_content: "Thinking..." }));
      const chunks = adapter.handleChunk(makeChunk({}, "stop"));
      const final = adapter.finalize();
      const all = [...chunks, ...final];

      const types = all.map((c) => c.type);
      expect(types).toContain("thinking-complete");
      expect(types.indexOf("thinking-complete")).toBeLessThan(types.indexOf("complete"));
    });
  });

  describe("tool calls", () => {
    test("emits tool-call-start when tool_calls appear in delta", () => {
      const adapter = createStreamingAdapter();
      const chunks = adapter.handleChunk(
        makeChunk({
          tool_calls: [{ index: 0, id: "call_1", function: { name: "search", arguments: "" } }],
        }),
      );

      const toolStarts = chunks.filter((c) => c.type === "tool-call-start");
      expect(toolStarts).toHaveLength(1);
      expect((toolStarts[0] as any).data.name).toBe("search");
      expect((toolStarts[0] as any).data.id).toBe("call_1");
    });

    test("closes active text before tool calls", () => {
      const adapter = createStreamingAdapter();
      adapter.handleChunk(makeChunk({ content: "Let me search" }));
      const chunks = adapter.handleChunk(
        makeChunk({
          tool_calls: [{ index: 0, id: "call_1", function: { name: "search", arguments: "{}" } }],
        }),
      );

      const types = chunks.map((c) => c.type);
      expect(types).toContain("text-complete");
      expect(types.indexOf("text-complete")).toBeLessThan(types.indexOf("tool-call-start"));
    });

    test("buffers tool call arguments across multiple chunks", () => {
      const adapter = createStreamingAdapter();
      adapter.handleChunk(
        makeChunk({
          tool_calls: [{ index: 0, id: "call_1", function: { name: "search", arguments: '{"q' } }],
        }),
      );
      adapter.handleChunk(
        makeChunk({
          tool_calls: [{ index: 0, function: { arguments: 'uery":"test"}' } }],
        }),
      );
      const chunks = adapter.handleChunk(makeChunk({}, "tool_calls"));

      const completeChunks = chunks.filter((c) => c.type === "tool-call-complete");
      expect(completeChunks).toHaveLength(1);
      expect((completeChunks[0] as any).data.arguments).toEqual({ query: "test" });
    });

    test("flushes tool calls on completion", () => {
      const adapter = createStreamingAdapter();
      adapter.handleChunk(
        makeChunk({
          tool_calls: [
            { index: 0, id: "call_1", function: { name: "search", arguments: '{"q":"test"}' } },
          ],
        }),
      );

      const chunks = adapter.handleChunk(makeChunk({}, "tool_calls"));

      const completeChunks = chunks.filter((c) => c.type === "tool-call-complete");
      expect(completeChunks).toHaveLength(1);
      expect((completeChunks[0] as any).data.name).toBe("search");
    });
  });

  describe("completion", () => {
    test("emits complete with stop reason via finalize", () => {
      const adapter = createStreamingAdapter();
      adapter.handleChunk(makeChunk({ content: "Hi" }));
      adapter.handleChunk(makeChunk({}, "stop"));
      const final = adapter.finalize();

      const complete = final.filter((c) => c.type === "complete");
      expect(complete).toHaveLength(1);
      expect((complete[0] as any).data.finishReason).toBe(AxleStopReason.Stop);
    });

    test("extracts usage from inline finish_reason chunk", () => {
      const adapter = createStreamingAdapter();
      adapter.handleChunk(makeChunk({ content: "Hi" }));

      const chunk: ChatCompletionChunk = {
        id: "chatcmpl-1",
        model: "test-model",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 42, completion_tokens: 17 },
      };
      adapter.handleChunk(chunk);
      const final = adapter.finalize();

      const complete = final.filter((c) => c.type === "complete");
      expect((complete[0] as any).data.usage).toEqual({ in: 42, out: 17 });
    });

    test("converts length finish reason", () => {
      const adapter = createStreamingAdapter();
      adapter.handleChunk(makeChunk({ content: "Hi" }));
      adapter.handleChunk(makeChunk({}, "length"));
      const final = adapter.finalize();

      const complete = final.filter((c) => c.type === "complete");
      expect((complete[0] as any).data.finishReason).toBe(AxleStopReason.Length);
    });

    test("converts tool_calls finish reason", () => {
      const adapter = createStreamingAdapter();
      adapter.handleChunk(
        makeChunk({
          tool_calls: [{ index: 0, id: "call_1", function: { name: "fn", arguments: "{}" } }],
        }),
      );
      adapter.handleChunk(makeChunk({}, "tool_calls"));
      const final = adapter.finalize();

      const complete = final.filter((c) => c.type === "complete");
      expect((complete[0] as any).data.finishReason).toBe(AxleStopReason.FunctionCall);
    });
  });

  describe("usage-only chunks", () => {
    test("picks up usage from separate tail chunk via finalize", () => {
      const adapter = createStreamingAdapter();
      adapter.handleChunk(makeChunk({ content: "Hi" }));
      adapter.handleChunk(makeChunk({}, "stop"));

      // Separate usage-only chunk (empty choices)
      adapter.handleChunk({
        id: "chatcmpl-1",
        model: "test-model",
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      });

      const final = adapter.finalize();
      const complete = final.filter((c) => c.type === "complete");
      expect(complete).toHaveLength(1);
      expect((complete[0] as any).data.usage).toEqual({ in: 10, out: 20 });
    });

    test("defaults to zero usage when no usage is provided", () => {
      const adapter = createStreamingAdapter();
      adapter.handleChunk(makeChunk({ content: "Hi" }));
      adapter.handleChunk(makeChunk({}, "stop"));
      const final = adapter.finalize();

      const complete = final.filter((c) => c.type === "complete");
      expect((complete[0] as any).data.usage).toEqual({ in: 0, out: 0 });
    });

    test("finalize returns empty when no finish_reason was seen", () => {
      const adapter = createStreamingAdapter();
      adapter.handleChunk(makeChunk({ content: "Hi" }));
      const final = adapter.finalize();
      expect(final).toHaveLength(0);
    });
  });
});

// Helpers

function makeChunk(
  delta: {
    content?: string;
    reasoning_content?: string;
    tool_calls?: any[];
  },
  finishReason?: string | null,
): ChatCompletionChunk {
  return {
    id: "chatcmpl-1",
    model: "test-model",
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason ?? null,
      },
    ],
  };
}
