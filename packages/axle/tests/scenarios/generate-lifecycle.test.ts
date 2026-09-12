import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { AxleAbortError } from "../../src/errors/AxleAbortError.js";
import { generate } from "../../src/providers/generate.js";
import type { AIProvider } from "../../src/providers/types.js";
import { AxleStopReason } from "../../src/providers/types.js";
import { makeStreamingProvider } from "./helpers/providers.js";
import { createTracerAndWriter } from "./helpers/recording-writer.js";

async function expectAbortError(promise: Promise<unknown>): Promise<AxleAbortError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AxleAbortError);
    return error as AxleAbortError;
  }

  throw new Error("Expected promise to reject with AxleAbortError");
}

import {
  startChunk,
  textStartChunk,
  textChunk,
  textCompleteChunk,
  completeChunk,
  toolCallStartChunk,
  toolCallCompleteChunk,
} from "./helpers/chunks.js";

describe("generate() wrapper lifecycle", () => {
  test("5.3 executes a local tool without onToolCall", async () => {
    const toolResponse = [
      startChunk("msg_1"),
      toolCallStartChunk(0, "call_1", "lookup"),
      toolCallCompleteChunk(0, "call_1", "lookup", { id: 42 }),
      completeChunk(AxleStopReason.FunctionCall, { in: 10, out: 15 }),
    ];

    const textResponse = [
      startChunk("msg_2"),
      textStartChunk(0),
      textChunk(0, "Here are the results"),
      textCompleteChunk(0),
      completeChunk(AxleStopReason.Stop, { in: 30, out: 25 }),
    ];

    const execute = vi.fn().mockResolvedValue("Found item 42");
    const provider = makeStreamingProvider([toolResponse, textResponse]);
    const result = await generate({
      provider,
      model: "test-model",
      messages: [{ role: "user", content: "Look up item 42" }],
      tools: [
        {
          name: "lookup",
          description: "Lookup an item",
          schema: z.object({ id: z.number() }),
          execute,
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(execute).toHaveBeenCalledWith({ id: 42 }, expect.anything());
    expect(result.messages[1]).toMatchObject({
      role: "tool",
      content: [{ id: "call_1", name: "lookup", content: "Found item 42" }],
    });
  });
  test("6.4 abort during provider request rejects with AxleAbortError and closes spans", async () => {
    const { writer, tracer } = createTracerAndWriter();
    const rootSpan = tracer.startSpan("generate", { type: "workflow" });
    const controller = new AbortController();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });

    const provider: AIProvider = {
      get name() {
        return "test";
      },
      async *createStreamingRequest(_model, { signal }) {
        requestStarted();
        await gate;
        if (signal?.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
        yield completeChunk();
      },
    };

    const pending = generate({
      provider,
      model: "test-model",
      messages: [{ role: "user", content: "Hi" }],
      span: rootSpan,
      signal: controller.signal,
    });

    const reason = "timeout";
    await started;
    controller.abort(reason);
    release();

    const error = await expectAbortError(pending);
    expect(error.name).toBe("AbortError");
    expect(error.reason).toBe(reason);
    expect(error.messages).toHaveLength(0);
    expect(error.usage).toEqual({ in: 0, out: 0 });

    const turn1Span = [...writer.spans.values()].find((s) => s.name === "step-1")!;
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

    const toolResponse = [
      startChunk("msg_1"),
      toolCallStartChunk(0, "call_1", "lookup"),
      toolCallCompleteChunk(0, "call_1", "lookup", { id: 42 }),
      completeChunk(AxleStopReason.FunctionCall, { in: 10, out: 15 }),
    ];

    const provider = makeStreamingProvider([toolResponse]);
    const pending = generate({
      provider,
      model: "test-model",
      messages: [{ role: "user", content: "Look up item 42" }],
      span: rootSpan,
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
    expect(error.usage).toMatchObject({
      in: 10,
      out: 15,
      breakdown: [{ provider: "test", model: "test-model" }],
    });

    const rootSpanData = [...writer.spans.values()].find((s) => s.name === "generate")!;
    expect(rootSpanData.status).toBe("ok");
  });

  test("6.6 pre-aborted signal rejects before provider work starts", async () => {
    const { writer, tracer } = createTracerAndWriter();
    const rootSpan = tracer.startSpan("generate", { type: "workflow" });
    const controller = new AbortController();
    controller.abort("pre-aborted");

    const createStreamingRequest = vi.fn();
    const provider: AIProvider = {
      get name() {
        return "test";
      },
      createStreamingRequest,
    };

    const error = await expectAbortError(
      generate({
        provider,
        model: "test-model",
        messages: [{ role: "user", content: "Hi" }],
        span: rootSpan,
        signal: controller.signal,
      }),
    );

    expect(error.reason).toBe("pre-aborted");
    expect(error.messages).toHaveLength(0);
    expect(error.usage).toEqual({ in: 0, out: 0 });
    expect(createStreamingRequest).not.toHaveBeenCalled();

    const rootSpanData = [...writer.spans.values()].find((s) => s.name === "generate")!;
    expect(rootSpanData.status).toBe("ok");
  });
});
