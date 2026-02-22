import { describe, expect, test } from "vitest";
import { generate } from "../../src/providers/generate.js";
import type { AIProvider, ModelError, ModelResponse } from "../../src/providers/types.js";
import { AxleStopReason } from "../../src/providers/types.js";
import { makeGenerateProvider } from "./helpers/providers.js";
import { createTracerAndWriter, eventIndex } from "./helpers/recording-writer.js";

// ─── 5. Happy paths ─────────────────────────────────────────────────────────

describe("generate() happy paths", () => {
  test("5.1 single-turn text response", async () => {
    const { writer, tracer } = createTracerAndWriter();
    const rootSpan = tracer.startSpan("generate", { type: "workflow" });

    const response: ModelResponse = {
      type: "success",
      role: "assistant",
      id: "msg_1",
      model: "test-model",
      text: "Hello world",
      content: [{ type: "text", text: "Hello world" }],
      finishReason: AxleStopReason.Stop,
      usage: { in: 10, out: 20 },
      raw: {},
    };

    const provider = makeGenerateProvider([response]);
    const result = await generate({
      provider,
      model: "test-model",
      messages: [{ role: "user", content: "Hi" }],
      tracer: rootSpan,
    });

    expect(result.result).toBe("success");

    const { timeline, spans } = writer;

    // Root + turn-1
    const spanStarts = timeline.filter((e) => e.type === "span:start");
    expect(spanStarts).toHaveLength(2);
    expect(spanStarts[0].name).toBe("generate");
    expect(spanStarts[1].name).toBe("turn-1");

    // turn-1 has at least one span:update (setResult)
    const turn1Updates = timeline.filter((e) => e.type === "span:update" && e.name === "turn-1");
    expect(turn1Updates.length).toBeGreaterThanOrEqual(1);

    // Final span states
    const turn1Span = [...spans.values()].find((s) => s.name === "turn-1")!;
    expect(turn1Span).toBeDefined();
    expect(turn1Span.result?.kind).toBe("llm");
    expect(turn1Span.status).toBe("ok");
    expect(turn1Span.type).toBe("llm");

    const rootSpanData = [...spans.values()].find((s) => s.name === "generate")!;
    expect(rootSpanData).toBeDefined();
    expect(rootSpanData.result?.kind).toBe("llm");
    expect(rootSpanData.status).toBe("ok");

    expect(turn1Span.parentSpanId).toBe(rootSpanData.spanId);

    // Result carries usage and finishReason
    if (turn1Span.result?.kind === "llm") {
      expect(turn1Span.result.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
      expect(turn1Span.result.finishReason).toBe(AxleStopReason.Stop);
    }
    if (rootSpanData.result?.kind === "llm") {
      expect(rootSpanData.result.finishReason).toBe(AxleStopReason.Stop);
    }

    // Ordering: turn-1 start → turn-1 end → root end
    const turn1StartIdx = eventIndex(timeline, "span:start", "turn-1");
    const turn1EndIdx = eventIndex(timeline, "span:end", "turn-1");
    const rootEndIdx = eventIndex(timeline, "span:end", "generate");
    expect(turn1StartIdx).toBeLessThan(turn1EndIdx);
    expect(turn1EndIdx).toBeLessThan(rootEndIdx);
  });

  test("5.2 multi-turn with tool call", async () => {
    const { writer, tracer } = createTracerAndWriter();
    const rootSpan = tracer.startSpan("generate", { type: "workflow" });

    const toolResponse: ModelResponse = {
      type: "success",
      role: "assistant",
      id: "msg_1",
      model: "test-model",
      text: "",
      content: [{ type: "tool-call", id: "call_1", name: "lookup", parameters: { id: 42 } }],
      finishReason: AxleStopReason.FunctionCall,
      usage: { in: 10, out: 15 },
      raw: {},
    };

    const textResponse: ModelResponse = {
      type: "success",
      role: "assistant",
      id: "msg_2",
      model: "test-model",
      text: "Here are the results",
      content: [{ type: "text", text: "Here are the results" }],
      finishReason: AxleStopReason.Stop,
      usage: { in: 30, out: 25 },
      raw: {},
    };

    const provider = makeGenerateProvider([toolResponse, textResponse]);
    const result = await generate({
      provider,
      model: "test-model",
      messages: [{ role: "user", content: "Look up item 42" }],
      tracer: rootSpan,
      onToolCall: async () => ({ type: "success", content: "Found item 42" }),
    });

    expect(result.result).toBe("success");

    const { timeline, spans } = writer;

    // root + turn-1 + lookup (tool) + turn-2
    const spanStarts = timeline.filter((e) => e.type === "span:start");
    expect(spanStarts).toHaveLength(4);
    expect(spanStarts.map((e) => e.name)).toEqual(["generate", "turn-1", "lookup", "turn-2"]);

    const rootSpanData = [...spans.values()].find((s) => s.name === "generate")!;
    const turn1Span = [...spans.values()].find((s) => s.name === "turn-1")!;
    const toolSpan = [...spans.values()].find((s) => s.name === "lookup")!;
    const turn2Span = [...spans.values()].find((s) => s.name === "turn-2")!;

    // Parent relationships
    expect(turn1Span.parentSpanId).toBe(rootSpanData.spanId);
    expect(toolSpan.parentSpanId).toBe(rootSpanData.spanId);
    expect(turn2Span.parentSpanId).toBe(rootSpanData.spanId);

    // Types
    expect(turn1Span.type).toBe("llm");
    expect(toolSpan.type).toBe("tool");
    expect(turn2Span.type).toBe("llm");

    // Ordering: turn-1 end → tool start → tool end → turn-2 start
    const turn1EndIdx = eventIndex(timeline, "span:end", "turn-1");
    const toolStartIdx = eventIndex(timeline, "span:start", "lookup");
    const toolEndIdx = eventIndex(timeline, "span:end", "lookup");
    const turn2StartIdx = eventIndex(timeline, "span:start", "turn-2");

    expect(turn1EndIdx).toBeLessThan(toolStartIdx);
    expect(toolEndIdx).toBeLessThan(turn2StartIdx);

    // All spans ok
    for (const span of spans.values()) {
      expect(span.status).toBe("ok");
    }

    // Messages accumulate correctly across turns
    if (result.result === "success") {
      expect(result.messages).toHaveLength(3);
      // Turn 1: assistant with tool call
      expect(result.messages[0].role).toBe("assistant");
      expect((result.messages[0] as any).content[0].type).toBe("tool-call");
      expect((result.messages[0] as any).content[0].name).toBe("lookup");
      // Tool result
      expect(result.messages[1].role).toBe("tool");
      // Turn 2: assistant with text
      expect(result.messages[2].role).toBe("assistant");
      expect((result.messages[2] as any).content[0].text).toBe("Here are the results");
      // final points to the last assistant message
      expect(result.final).toBe(result.messages[2]);
    }
  });
});

// ─── 6. Error paths ─────────────────────────────────────────────────────────

describe("generate() error paths", () => {
  test("6.1 provider returns ModelError", async () => {
    const { writer, tracer } = createTracerAndWriter();
    const rootSpan = tracer.startSpan("generate", { type: "workflow" });

    const errorResponse: ModelError = {
      type: "error",
      error: { type: "api_error", message: "Internal server error" },
    };

    const provider = makeGenerateProvider([errorResponse]);
    const result = await generate({
      provider,
      model: "test-model",
      messages: [{ role: "user", content: "Hi" }],
      tracer: rootSpan,
    });

    expect(result.result).toBe("error");
    if (result.result === "error") {
      expect(result.error.type).toBe("model");
    }

    const { spans } = writer;

    const turn1Span = [...spans.values()].find((s) => s.name === "turn-1")!;
    expect(turn1Span).toBeDefined();
    expect(turn1Span.status).toBe("error");

    const rootSpanData = [...spans.values()].find((s) => s.name === "generate")!;
    expect(rootSpanData).toBeDefined();
    expect(rootSpanData.status).toBe("error");
  });

  test("6.2 max iterations exceeded", async () => {
    const { writer, tracer } = createTracerAndWriter();
    const rootSpan = tracer.startSpan("generate", { type: "workflow" });

    const toolResponse: ModelResponse = {
      type: "success",
      role: "assistant",
      id: "msg_1",
      model: "test-model",
      text: "",
      content: [{ type: "tool-call", id: "call_1", name: "search", parameters: {} }],
      finishReason: AxleStopReason.FunctionCall,
      usage: { in: 10, out: 10 },
      raw: {},
    };

    const provider = makeGenerateProvider([toolResponse]);
    const result = await generate({
      provider,
      model: "test-model",
      messages: [{ role: "user", content: "Search" }],
      tracer: rootSpan,
      maxIterations: 1,
      onToolCall: async () => ({ type: "success", content: "result" }),
    });

    expect(result.result).toBe("error");
    if (result.result === "error" && result.error.type === "model") {
      const inner = result.error.error.error;
      expect(inner.type).toBe("MaxIterations");
      expect(inner.message).toContain("max iterations");
    }

    const { spans } = writer;

    const rootSpanData = [...spans.values()].find((s) => s.name === "generate")!;
    expect(rootSpanData.status).toBe("error");
  });

  test("6.3 provider throws rejects promise and leaks spans", async () => {
    const { writer, tracer } = createTracerAndWriter();
    const rootSpan = tracer.startSpan("generate", { type: "workflow" });

    const provider: AIProvider = {
      get name() {
        return "test";
      },
      async createGenerationRequest() {
        throw new Error("Network failure");
      },
    };

    await expect(
      generate({
        provider,
        model: "test-model",
        messages: [{ role: "user", content: "Hi" }],
        tracer: rootSpan,
      }),
    ).rejects.toThrow("Network failure");

    const { timeline } = writer;

    // turn-1 span was started but never ended (leaked)
    const turn1Starts = timeline.filter((e) => e.type === "span:start" && e.name === "turn-1");
    const turn1Ends = timeline.filter((e) => e.type === "span:end" && e.name === "turn-1");
    expect(turn1Starts).toHaveLength(1);
    expect(turn1Ends).toHaveLength(0);

    // Root span also never ended
    const rootEnds = timeline.filter((e) => e.type === "span:end" && e.name === "generate");
    expect(rootEnds).toHaveLength(0);
  });
});
