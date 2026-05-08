import { describe, expect, test, vi } from "vitest";
import { AxleAbortError } from "../../src/errors/AxleAbortError.js";
import { generate } from "../../src/providers/generate.js";
import type { AIProvider, ModelError, ModelResponse } from "../../src/providers/types.js";
import { AxleStopReason } from "../../src/providers/types.js";
import { makeGenerateProvider } from "./helpers/providers.js";
import { createTracerAndWriter, eventIndex } from "./helpers/recording-writer.js";

async function expectAbortError(promise: Promise<unknown>): Promise<AxleAbortError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AxleAbortError);
    return error as AxleAbortError;
  }

  throw new Error("Expected promise to reject with AxleAbortError");
}

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
      async *createStreamingRequest() {
        throw new Error("Not implemented");
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

  test("6.4 abort during provider request rejects with AxleAbortError and closes spans", async () => {
    const { writer, tracer } = createTracerAndWriter();
    const rootSpan = tracer.startSpan("generate", { type: "workflow" });
    const controller = new AbortController();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const provider: AIProvider = {
      get name() {
        return "test";
      },
      async createGenerationRequest(_model, { signal }) {
        await gate;
        if (signal?.aborted) {
          const error = new Error("Aborted");
          error.name = "AbortError";
          throw error;
        }

        return {
          type: "success",
          role: "assistant",
          id: "msg_abort",
          model: "test-model",
          text: "done",
          content: [{ type: "text", text: "done" }],
          finishReason: AxleStopReason.Stop,
          usage: { in: 1, out: 1 },
          raw: {},
        };
      },
      async *createStreamingRequest() {
        throw new Error("Not implemented");
      },
    };

    const pending = generate({
      provider,
      model: "test-model",
      messages: [{ role: "user", content: "Hi" }],
      tracer: rootSpan,
      signal: controller.signal,
    });

    const reason = "timeout";
    controller.abort(reason);
    release();

    const error = await expectAbortError(pending);
    expect(error.name).toBe("AbortError");
    expect(error.reason).toBe(reason);
    expect(error.messages).toHaveLength(0);
    expect(error.usage).toEqual({ in: 0, out: 0 });

    const turn1Span = [...writer.spans.values()].find((s) => s.name === "turn-1")!;
    const rootSpanData = [...writer.spans.values()].find((s) => s.name === "generate")!;
    expect(turn1Span.status).toBe("ok");
    expect(rootSpanData.status).toBe("ok");
  });

  test("6.5 abort during tool execution rejects with AxleAbortError and preserves prior state", async () => {
    const { writer, tracer } = createTracerAndWriter();
    const rootSpan = tracer.startSpan("generate", { type: "workflow" });
    const controller = new AbortController();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markToolStarted!: () => void;
    const toolStarted = new Promise<void>((resolve) => {
      markToolStarted = resolve;
    });

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

    const provider = makeGenerateProvider([toolResponse]);
    const pending = generate({
      provider,
      model: "test-model",
      messages: [{ role: "user", content: "Look up item 42" }],
      tracer: rootSpan,
      signal: controller.signal,
      onToolCall: async (_name, _params, ctx) => {
        markToolStarted();
        await gate;
        if (ctx.signal.aborted) {
          const error = new Error("Aborted");
          error.name = "AbortError";
          throw error;
        }
        return { type: "success", content: "Found item 42" };
      },
    });

    await toolStarted;
    controller.abort({ type: "tool-timeout" });
    release();

    const error = await expectAbortError(pending);
    expect(error.reason).toEqual({ type: "tool-timeout" });
    expect(error.messages).toHaveLength(1);
    expect(error.messages![0].role).toBe("assistant");
    expect(error.usage).toEqual({ in: 10, out: 15 });

    const rootSpanData = [...writer.spans.values()].find((s) => s.name === "generate")!;
    expect(rootSpanData.status).toBe("ok");
  });

  test("6.6 pre-aborted signal rejects before provider work starts", async () => {
    const { writer, tracer } = createTracerAndWriter();
    const rootSpan = tracer.startSpan("generate", { type: "workflow" });
    const controller = new AbortController();
    controller.abort("pre-aborted");

    const createGenerationRequest = vi.fn();
    const provider: AIProvider = {
      get name() {
        return "test";
      },
      createGenerationRequest,
      async *createStreamingRequest() {
        throw new Error("Not implemented");
      },
    };

    const error = await expectAbortError(
      generate({
        provider,
        model: "test-model",
        messages: [{ role: "user", content: "Hi" }],
        tracer: rootSpan,
        signal: controller.signal,
      }),
    );

    expect(error.reason).toBe("pre-aborted");
    expect(error.messages).toHaveLength(0);
    expect(error.usage).toEqual({ in: 0, out: 0 });
    expect(createGenerationRequest).not.toHaveBeenCalled();

    const rootSpanData = [...writer.spans.values()].find((s) => s.name === "generate")!;
    expect(rootSpanData.status).toBe("ok");
  });
});
