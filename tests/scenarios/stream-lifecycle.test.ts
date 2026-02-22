import { describe, expect, test } from "vitest";
import type { AnyStreamChunk } from "../../src/messages/stream.js";
import { stream } from "../../src/providers/stream.js";
import type { AIProvider } from "../../src/providers/types.js";
import { AxleStopReason } from "../../src/providers/types.js";
import {
  completeChunk,
  errorChunk,
  startChunk,
  textChunk,
  textCompleteChunk,
  textStartChunk,
  thinkingCompleteChunk,
  thinkingDeltaChunk,
  thinkingStartChunk,
  toolCallCompleteChunk,
  toolCallStartChunk,
} from "./helpers/chunks.js";
import { makeAsyncStreamingProvider, makeStreamingProvider } from "./helpers/providers.js";
import { createTracerAndWriter, eventIndex } from "./helpers/recording-writer.js";

// ─── 1. Happy paths ─────────────────────────────────────────────────────────

describe("stream() happy paths", () => {
  test("1.1 single-turn text response", async () => {
    const { writer, tracer } = createTracerAndWriter();
    const rootSpan = tracer.startSpan("stream", { type: "workflow" });

    const chunks: AnyStreamChunk[] = [
      startChunk(),
      textStartChunk(0),
      textChunk(0, "Hello"),
      textChunk(0, " world"),
      textCompleteChunk(0),
      completeChunk(),
    ];

    const provider = makeStreamingProvider([chunks]);
    const handle = stream({
      provider,
      model: "test-model",
      messages: [],
      tracer: rootSpan,
    });

    const result = await handle.final;
    expect(result.result).toBe("success");

    const { timeline, spans } = writer;

    // Root span + turn-1 span
    const spanStarts = timeline.filter((e) => e.type === "span:start");
    expect(spanStarts).toHaveLength(2);
    expect(spanStarts[0].name).toBe("stream");
    expect(spanStarts[1].name).toBe("turn-1");

    // turn-1 lifecycle: start → update (setResult) → end
    const turn1Start = eventIndex(timeline, "span:start", "turn-1");
    const turn1Update = eventIndex(timeline, "span:update", "turn-1");
    const turn1End = eventIndex(timeline, "span:end", "turn-1");

    expect(turn1Start).toBeLessThan(turn1Update);
    expect(turn1Update).toBeLessThan(turn1End);

    // Root lifecycle: span:start → span:update(setResult) → span:end
    const rootStart = eventIndex(timeline, "span:start", "stream");
    const rootUpdate = eventIndex(timeline, "span:update", "stream");
    const rootEnd = eventIndex(timeline, "span:end", "stream");
    expect(rootStart).toBeLessThan(rootUpdate);
    expect(rootUpdate).toBeLessThan(rootEnd);

    // Final span states
    const turn1Span = [...spans.values()].find((s) => s.name === "turn-1")!;
    expect(turn1Span).toBeDefined();
    expect(turn1Span.result?.kind).toBe("llm");
    expect(turn1Span.status).toBe("ok");
    expect(turn1Span.type).toBe("llm");

    const rootSpanData = [...spans.values()].find((s) => s.name === "stream")!;
    expect(rootSpanData).toBeDefined();
    expect(rootSpanData.result?.kind).toBe("llm");
    expect(rootSpanData.status).toBe("ok");

    // turn-1 is a child of root
    expect(turn1Span.parentSpanId).toBe(rootSpanData.spanId);

    // Result carries usage and finishReason
    if (turn1Span.result?.kind === "llm") {
      expect(turn1Span.result.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
      expect(turn1Span.result.finishReason).toBe(AxleStopReason.Stop);
    }
    if (rootSpanData.result?.kind === "llm") {
      expect(rootSpanData.result.finishReason).toBe(AxleStopReason.Stop);
    }
  });

  test("1.2 multi-turn with tool call", async () => {
    const { writer, tracer } = createTracerAndWriter();
    const rootSpan = tracer.startSpan("stream", { type: "workflow" });

    const turn1Chunks: AnyStreamChunk[] = [
      startChunk("msg_1"),
      toolCallStartChunk(0, "call_1", "web_search"),
      toolCallCompleteChunk(0, "call_1", "web_search", { q: "test" }),
      completeChunk(AxleStopReason.FunctionCall),
    ];

    const turn2Chunks: AnyStreamChunk[] = [
      startChunk("msg_2"),
      textStartChunk(0),
      textChunk(0, "Results"),
      textCompleteChunk(0),
      completeChunk(),
    ];

    const provider = makeStreamingProvider([turn1Chunks, turn2Chunks]);
    const handle = stream({
      provider,
      model: "test-model",
      messages: [],
      tracer: rootSpan,
      onToolCall: async () => ({ type: "success", content: "search results" }),
    });

    const result = await handle.final;
    expect(result.result).toBe("success");

    const { timeline, spans } = writer;

    // 4 span:start events: root + turn-1 + web_search (tool) + turn-2
    const spanStarts = timeline.filter((e) => e.type === "span:start");
    expect(spanStarts).toHaveLength(4);
    expect(spanStarts.map((e) => e.name)).toEqual(["stream", "turn-1", "web_search", "turn-2"]);

    const rootSpanData = [...spans.values()].find((s) => s.name === "stream")!;
    const turn1Span = [...spans.values()].find((s) => s.name === "turn-1")!;
    const toolSpan = [...spans.values()].find((s) => s.name === "web_search")!;
    const turn2Span = [...spans.values()].find((s) => s.name === "turn-2")!;

    expect(turn1Span.parentSpanId).toBe(rootSpanData.spanId);
    expect(toolSpan.parentSpanId).toBe(rootSpanData.spanId);
    expect(turn2Span.parentSpanId).toBe(rootSpanData.spanId);

    expect(turn1Span.type).toBe("llm");
    expect(toolSpan.type).toBe("tool");
    expect(turn2Span.type).toBe("llm");

    expect(toolSpan.result?.kind).toBe("tool");
    if (toolSpan.result?.kind === "tool") {
      expect(toolSpan.result.name).toBe("web_search");
    }
    expect(toolSpan.status).toBe("ok");

    // Ordering: turn-1 ends before tool starts, tool ends before turn-2 starts
    const turn1EndIdx = eventIndex(timeline, "span:end", "turn-1");
    const toolStartIdx = eventIndex(timeline, "span:start", "web_search");
    const toolEndIdx = eventIndex(timeline, "span:end", "web_search");
    const turn2StartIdx = eventIndex(timeline, "span:start", "turn-2");

    expect(turn1EndIdx).toBeLessThan(toolStartIdx);
    expect(toolEndIdx).toBeLessThan(turn2StartIdx);

    expect(turn1Span.status).toBe("ok");
    expect(turn2Span.status).toBe("ok");
    expect(rootSpanData.status).toBe("ok");

    // Messages accumulate correctly across turns
    if (result.result === "success") {
      expect(result.messages).toHaveLength(3);
      // Turn 1: assistant with tool call
      expect(result.messages[0].role).toBe("assistant");
      expect((result.messages[0] as any).content[0].type).toBe("tool-call");
      expect((result.messages[0] as any).content[0].name).toBe("web_search");
      // Tool result
      expect(result.messages[1].role).toBe("tool");
      // Turn 2: assistant with text
      expect(result.messages[2].role).toBe("assistant");
      expect((result.messages[2] as any).content[0].type).toBe("text");
      expect((result.messages[2] as any).content[0].text).toBe("Results");
      // final points to the last assistant message
      expect(result.final).toBe(result.messages[2]);
      // Usage accumulates across both turns (default 10 in / 20 out each)
      expect(result.usage).toEqual({ in: 20, out: 40 });
    }
  });

  test("1.3 multiple tool calls in one turn", async () => {
    const { writer, tracer } = createTracerAndWriter();
    const rootSpan = tracer.startSpan("stream", { type: "workflow" });

    const turn1Chunks: AnyStreamChunk[] = [
      startChunk("msg_1"),
      toolCallStartChunk(0, "call_1", "search"),
      toolCallCompleteChunk(0, "call_1", "search", { q: "a" }),
      toolCallStartChunk(1, "call_2", "calculator"),
      toolCallCompleteChunk(1, "call_2", "calculator", { expr: "1+1" }),
      completeChunk(AxleStopReason.FunctionCall),
    ];

    const turn2Chunks: AnyStreamChunk[] = [
      startChunk("msg_2"),
      textStartChunk(0),
      textChunk(0, "Done"),
      textCompleteChunk(0),
      completeChunk(),
    ];

    const provider = makeStreamingProvider([turn1Chunks, turn2Chunks]);
    const handle = stream({
      provider,
      model: "test-model",
      messages: [],
      tracer: rootSpan,
      onToolCall: async () => ({ type: "success", content: "ok" }),
    });

    const result = await handle.final;
    expect(result.result).toBe("success");

    const { timeline, spans } = writer;

    // root + turn-1 + search + calculator + turn-2
    const spanStarts = timeline.filter((e) => e.type === "span:start");
    expect(spanStarts).toHaveLength(5);
    expect(spanStarts.map((e) => e.name)).toEqual([
      "stream",
      "turn-1",
      "search",
      "calculator",
      "turn-2",
    ]);

    // Both tool spans are children of root
    const rootSpanData = [...spans.values()].find((s) => s.name === "stream")!;
    const searchSpan = [...spans.values()].find((s) => s.name === "search")!;
    const calcSpan = [...spans.values()].find((s) => s.name === "calculator")!;
    expect(searchSpan.parentSpanId).toBe(rootSpanData.spanId);
    expect(calcSpan.parentSpanId).toBe(rootSpanData.spanId);
    expect(searchSpan.type).toBe("tool");
    expect(calcSpan.type).toBe("tool");
    expect(searchSpan.status).toBe("ok");
    expect(calcSpan.status).toBe("ok");

    // search ends before calculator starts (sequential execution)
    const searchEnd = eventIndex(timeline, "span:end", "search");
    const calcStart = eventIndex(timeline, "span:start", "calculator");
    expect(searchEnd).toBeLessThan(calcStart);
  });

  test("1.5 thinking + text response", async () => {
    const { writer, tracer } = createTracerAndWriter();
    const rootSpan = tracer.startSpan("stream", { type: "workflow" });

    const chunks: AnyStreamChunk[] = [
      startChunk(),
      thinkingStartChunk(0),
      thinkingDeltaChunk(0, "Let me think..."),
      thinkingDeltaChunk(0, " about this."),
      thinkingCompleteChunk(0),
      textStartChunk(1),
      textChunk(1, "Here is my answer"),
      textCompleteChunk(1),
      completeChunk(),
    ];

    const provider = makeStreamingProvider([chunks]);
    const handle = stream({
      provider,
      model: "test-model",
      messages: [],
      tracer: rootSpan,
    });

    const result = await handle.final;
    expect(result.result).toBe("success");

    // Span result contains both thinking and text parts
    const { spans } = writer;
    const turn1Span = [...spans.values()].find((s) => s.name === "turn-1")!;
    expect(turn1Span.result?.kind).toBe("llm");
    if (turn1Span.result?.kind === "llm") {
      const content = turn1Span.result.response.content as any[];
      expect(content).toHaveLength(2);
      expect(content[0].type).toBe("thinking");
      expect(content[0].text).toBe("Let me think... about this.");
      expect(content[1].type).toBe("text");
      expect(content[1].text).toBe("Here is my answer");
    }
  });
});

// ─── 2. Error paths ─────────────────────────────────────────────────────────

describe("stream() error paths", () => {
  test("2.1 error chunk mid-stream", async () => {
    const { writer, tracer } = createTracerAndWriter();
    const rootSpan = tracer.startSpan("stream", { type: "workflow" });

    const chunks: AnyStreamChunk[] = [startChunk(), errorChunk("rate_limit", "Too many requests")];

    const provider = makeStreamingProvider([chunks]);
    const handle = stream({
      provider,
      model: "test-model",
      messages: [],
      tracer: rootSpan,
    });

    const result = await handle.final;
    expect(result.result).toBe("error");

    const { timeline, spans } = writer;

    const spanStarts = timeline.filter((e) => e.type === "span:start");
    expect(spanStarts).toHaveLength(2);

    const turn1Span = [...spans.values()].find((s) => s.name === "turn-1")!;
    expect(turn1Span).toBeDefined();
    expect(turn1Span.status).toBe("error");

    const rootSpanData = [...spans.values()].find((s) => s.name === "stream")!;
    expect(rootSpanData).toBeDefined();
    expect(rootSpanData.status).toBe("error");
    expect(rootSpanData.result?.kind).toBe("llm");
    if (rootSpanData.result?.kind === "llm") {
      expect(rootSpanData.result.finishReason).toBeUndefined();
    }

    // turn-1 ends with error before root ends with error
    const turn1End = timeline.find((e) => e.type === "span:end" && e.name === "turn-1");
    const rootEnd = timeline.find((e) => e.type === "span:end" && e.name === "stream");
    expect(turn1End).toBeDefined();
    expect(rootEnd).toBeDefined();
    expect((turn1End as any).status).toBe("error");
    expect((rootEnd as any).status).toBe("error");
  });

  test("2.2 error after partial text", async () => {
    const { writer, tracer } = createTracerAndWriter();
    const rootSpan = tracer.startSpan("stream", { type: "workflow" });

    const chunks: AnyStreamChunk[] = [
      startChunk(),
      textStartChunk(0),
      textChunk(0, "Partial"),
      errorChunk("server_error", "Connection lost"),
    ];

    const provider = makeStreamingProvider([chunks]);
    const handle = stream({
      provider,
      model: "test-model",
      messages: [],
      tracer: rootSpan,
    });

    const result = await handle.final;
    expect(result.result).toBe("error");

    const { spans } = writer;

    // Both turn and root marked error
    const turn1Span = [...spans.values()].find((s) => s.name === "turn-1")!;
    expect(turn1Span.status).toBe("error");

    const rootSpanData = [...spans.values()].find((s) => s.name === "stream")!;
    expect(rootSpanData.status).toBe("error");
  });

  test("2.3 incomplete stream (no complete chunk)", async () => {
    const { writer, tracer } = createTracerAndWriter();
    const rootSpan = tracer.startSpan("stream", { type: "workflow" });

    // Stream ends without a complete or error chunk
    const chunks: AnyStreamChunk[] = [
      startChunk(),
      textStartChunk(0),
      textChunk(0, "Truncated"),
      textCompleteChunk(0),
    ];

    const provider = makeStreamingProvider([chunks]);
    const handle = stream({
      provider,
      model: "test-model",
      messages: [],
      tracer: rootSpan,
    });

    const result = await handle.final;
    expect(result.result).toBe("error");
    if (result.result === "error" && result.error.type === "model") {
      const inner = result.error.error.error;
      expect(inner.type).toBe("IncompleteStream");
      expect(inner.message).toBe("Stream ended without a completion signal");
    }

    const { spans } = writer;

    const turn1Span = [...spans.values()].find((s) => s.name === "turn-1")!;
    expect(turn1Span.status).toBe("error");

    const rootSpanData = [...spans.values()].find((s) => s.name === "stream")!;
    expect(rootSpanData.status).toBe("error");
  });

  test("2.4 max iterations exceeded", async () => {
    const { writer, tracer } = createTracerAndWriter();
    const rootSpan = tracer.startSpan("stream", { type: "workflow" });

    // First turn returns a tool call → loop would continue, but maxIterations=1
    const turn1Chunks: AnyStreamChunk[] = [
      startChunk("msg_1"),
      toolCallStartChunk(0, "call_1", "search"),
      toolCallCompleteChunk(0, "call_1", "search", { q: "test" }),
      completeChunk(AxleStopReason.FunctionCall),
    ];

    const provider = makeStreamingProvider([turn1Chunks]);
    const handle = stream({
      provider,
      model: "test-model",
      messages: [],
      tracer: rootSpan,
      maxIterations: 1,
      onToolCall: async () => ({ type: "success", content: "result" }),
    });

    const result = await handle.final;
    expect(result.result).toBe("error");
    if (result.result === "error" && result.error.type === "model") {
      const inner = result.error.error.error;
      expect(inner.type).toBe("MaxIterations");
      expect(inner.message).toContain("max iterations");
    }

    const { spans } = writer;

    const rootSpanData = [...spans.values()].find((s) => s.name === "stream")!;
    expect(rootSpanData.status).toBe("error");
  });

  test("2.5 provider generator throws rejects promise and leaks spans", async () => {
    const { writer, tracer } = createTracerAndWriter();
    const rootSpan = tracer.startSpan("stream", { type: "workflow" });

    const provider: AIProvider = {
      get name() {
        return "test";
      },
      async createGenerationRequest() {
        throw new Error("Not implemented");
      },
      async *createStreamingRequest() {
        yield startChunk();
        throw new Error("Connection refused");
      },
    };

    const handle = stream({
      provider,
      model: "test-model",
      messages: [],
      tracer: rootSpan,
    });

    await expect(handle.final).rejects.toThrow("Connection refused");

    const { timeline } = writer;

    // turn-1 span was started but never ended (leaked)
    const turn1Starts = timeline.filter((e) => e.type === "span:start" && e.name === "turn-1");
    const turn1Ends = timeline.filter((e) => e.type === "span:end" && e.name === "turn-1");
    expect(turn1Starts).toHaveLength(1);
    expect(turn1Ends).toHaveLength(0);

    // Root span also never ended
    const rootEnds = timeline.filter((e) => e.type === "span:end" && e.name === "stream");
    expect(rootEnds).toHaveLength(0);
  });
});

// ─── 3. Cancellation paths ──────────────────────────────────────────────────

describe("stream() cancellation paths", () => {
  test("3.1 cancel before first iteration", async () => {
    const { writer, tracer } = createTracerAndWriter();
    const rootSpan = tracer.startSpan("stream", { type: "workflow" });

    const chunks: AnyStreamChunk[] = [
      startChunk(),
      textStartChunk(0),
      textChunk(0, "Should not appear"),
      textCompleteChunk(0),
      completeChunk(),
    ];

    const provider = makeStreamingProvider([chunks]);
    const handle = stream({
      provider,
      model: "test-model",
      messages: [],
      tracer: rootSpan,
    });

    // Deterministic: stream() defers run() via Promise.resolve().then(),
    // so cancel() sets the abort flag before the microtask fires.
    handle.cancel();

    const result = await handle.final;
    expect(result.result).toBe("cancelled");
  });

  test("3.2 cancel mid-stream", async () => {
    const { writer, tracer } = createTracerAndWriter();
    const rootSpan = tracer.startSpan("stream", { type: "workflow" });

    const chunks: AnyStreamChunk[] = [
      startChunk(),
      textStartChunk(0),
      textChunk(0, "First"),
      textChunk(0, " Second"),
      textCompleteChunk(0),
      completeChunk(),
    ];

    // Pause after 3 chunks (start, text-start, text "First"), then we cancel
    const { provider, resume, gateReached } = makeAsyncStreamingProvider([chunks], 3);
    const handle = stream({
      provider,
      model: "test-model",
      messages: [],
      tracer: rootSpan,
    });

    // Wait until the generator has actually paused at the gate
    await gateReached;

    handle.cancel();
    resume();

    const result = await handle.final;
    expect(result.result).toBe("cancelled");
  });
});

// ─── 7. Tool span details ───────────────────────────────────────────────────

describe("stream() tool span details", () => {
  test("7.2 tool not found (onToolCall returns null)", async () => {
    const { writer, tracer } = createTracerAndWriter();
    const rootSpan = tracer.startSpan("stream", { type: "workflow" });

    const turn1Chunks: AnyStreamChunk[] = [
      startChunk("msg_1"),
      toolCallStartChunk(0, "call_1", "unknown_tool"),
      toolCallCompleteChunk(0, "call_1", "unknown_tool", {}),
      completeChunk(AxleStopReason.FunctionCall),
    ];

    const turn2Chunks: AnyStreamChunk[] = [
      startChunk("msg_2"),
      textStartChunk(0),
      textChunk(0, "Fallback"),
      textCompleteChunk(0),
      completeChunk(),
    ];

    const provider = makeStreamingProvider([turn1Chunks, turn2Chunks]);
    const handle = stream({
      provider,
      model: "test-model",
      messages: [],
      tracer: rootSpan,
      // Return null → tool not found
      onToolCall: async () => null,
    });

    const result = await handle.final;
    expect(result.result).toBe("success");

    const { spans } = writer;

    const toolSpan = [...spans.values()].find((s) => s.name === "unknown_tool")!;
    expect(toolSpan).toBeDefined();
    expect(toolSpan.type).toBe("tool");
    expect(toolSpan.status).toBe("error");
    expect(toolSpan.result?.kind).toBe("tool");
    if (toolSpan.result?.kind === "tool") {
      expect(toolSpan.result.output).toBeNull();
    }
  });

  test("7.3 tool returns error result", async () => {
    const { writer, tracer } = createTracerAndWriter();
    const rootSpan = tracer.startSpan("stream", { type: "workflow" });

    const turn1Chunks: AnyStreamChunk[] = [
      startChunk("msg_1"),
      toolCallStartChunk(0, "call_1", "failing_tool"),
      toolCallCompleteChunk(0, "call_1", "failing_tool", { x: 1 }),
      completeChunk(AxleStopReason.FunctionCall),
    ];

    const turn2Chunks: AnyStreamChunk[] = [
      startChunk("msg_2"),
      textStartChunk(0),
      textChunk(0, "Handled"),
      textCompleteChunk(0),
      completeChunk(),
    ];

    const provider = makeStreamingProvider([turn1Chunks, turn2Chunks]);
    const handle = stream({
      provider,
      model: "test-model",
      messages: [],
      tracer: rootSpan,
      onToolCall: async () => ({
        type: "error",
        error: { type: "validation", message: "Invalid input" },
      }),
    });

    const result = await handle.final;
    expect(result.result).toBe("success");

    const { spans } = writer;

    const toolSpan = [...spans.values()].find((s) => s.name === "failing_tool")!;
    expect(toolSpan).toBeDefined();
    expect(toolSpan.type).toBe("tool");
    expect(toolSpan.status).toBe("error");
    expect(toolSpan.result?.kind).toBe("tool");
  });

  test("7.4 tool throws exception", async () => {
    const { writer, tracer } = createTracerAndWriter();
    const rootSpan = tracer.startSpan("stream", { type: "workflow" });

    const turn1Chunks: AnyStreamChunk[] = [
      startChunk("msg_1"),
      toolCallStartChunk(0, "call_1", "crashing_tool"),
      toolCallCompleteChunk(0, "call_1", "crashing_tool", {}),
      completeChunk(AxleStopReason.FunctionCall),
    ];

    const turn2Chunks: AnyStreamChunk[] = [
      startChunk("msg_2"),
      textStartChunk(0),
      textChunk(0, "Recovered"),
      textCompleteChunk(0),
      completeChunk(),
    ];

    const provider = makeStreamingProvider([turn1Chunks, turn2Chunks]);
    const handle = stream({
      provider,
      model: "test-model",
      messages: [],
      tracer: rootSpan,
      onToolCall: async () => {
        throw new Error("Unexpected crash");
      },
    });

    const result = await handle.final;
    expect(result.result).toBe("success");

    const { spans } = writer;

    const toolSpan = [...spans.values()].find((s) => s.name === "crashing_tool")!;
    expect(toolSpan).toBeDefined();
    expect(toolSpan.type).toBe("tool");
    // executeToolCalls catches exceptions and treats them as errors
    expect(toolSpan.status).toBe("error");
    expect(toolSpan.result?.kind).toBe("tool");
  });
});
