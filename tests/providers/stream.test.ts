import { describe, expect, test } from "vitest";
import type {
  AnyStreamChunk,
  StreamCompleteChunk,
  StreamErrorChunk,
  StreamStartChunk,
  StreamTextCompleteChunk,
  StreamTextDeltaChunk,
  StreamTextStartChunk,
  StreamThinkingCompleteChunk,
  StreamThinkingDeltaChunk,
  StreamThinkingStartChunk,
  StreamToolCallCompleteChunk,
  StreamToolCallStartChunk,
} from "../../src/messages/stream.js";
import { stream, type StreamEvent } from "../../src/providers/stream.js";
import type { AIProvider } from "../../src/providers/types.js";
import { AxleStopReason } from "../../src/providers/types.js";

// --- Helpers ---

function makeProvider(opts: {
  streamChunks?: AnyStreamChunk[][];
  streamFactory?: () => AsyncGenerator<AnyStreamChunk, void, unknown>;
  supportsStreaming?: boolean;
}): AIProvider {
  const { streamChunks, streamFactory, supportsStreaming = true } = opts;
  let streamCallIndex = 0;

  const provider: AIProvider = {
    get name() {
      return "test";
    },
    async createGenerationRequest(_model: string) {
      throw new Error("Not implemented");
    },
  };

  if (supportsStreaming && streamFactory) {
    provider.createStreamingRequest = (() => streamFactory()) as any;
  } else if (supportsStreaming && streamChunks) {
    provider.createStreamingRequest = function* (_model: string) {
      const chunks = streamChunks[streamCallIndex++];
      if (!chunks) throw new Error("No stream chunks configured");
      for (const chunk of chunks) {
        yield chunk;
      }
    } as any;
  }

  return provider;
}

function startChunk(id = "msg_1", model = "test-model"): StreamStartChunk {
  return { type: "start", id, data: { model, timestamp: Date.now() } };
}

function textStartChunk(index: number): StreamTextStartChunk {
  return { type: "text-start", data: { index } };
}

function textChunk(index: number, text: string): StreamTextDeltaChunk {
  return { type: "text-delta", data: { index, text } };
}

function textCompleteChunk(index: number): StreamTextCompleteChunk {
  return { type: "text-complete", data: { index } };
}

function thinkingStartChunk(index: number): StreamThinkingStartChunk {
  return { type: "thinking-start", data: { index } };
}

function thinkingDeltaChunk(index: number, text: string): StreamThinkingDeltaChunk {
  return { type: "thinking-delta", data: { index, text } };
}

function thinkingCompleteChunk(index: number): StreamThinkingCompleteChunk {
  return { type: "thinking-complete", data: { index } };
}

function toolCallStartChunk(index: number, id: string, name: string): StreamToolCallStartChunk {
  return { type: "tool-call-start", data: { index, id, name } };
}

function toolCallCompleteChunk(
  index: number,
  id: string,
  name: string,
  args: any,
): StreamToolCallCompleteChunk {
  return { type: "tool-call-complete", data: { index, id, name, arguments: args } };
}

function completeChunk(
  finishReason: AxleStopReason = AxleStopReason.Stop,
  usage = { in: 10, out: 20 },
): StreamCompleteChunk {
  return { type: "complete", data: { finishReason, usage } };
}

function errorChunk(type = "server_error", message = "Something went wrong"): StreamErrorChunk {
  return { type: "error", data: { type, message } };
}

function collectEvents() {
  const events: StreamEvent[] = [];
  const callback = (event: StreamEvent) => {
    events.push(event);
  };
  return { events, callback };
}

// --- Tests ---

describe("stream()", () => {
  describe("no tool calls — text only", () => {
    test("forwards text chunks and returns success", async () => {
      const chunks: AnyStreamChunk[] = [
        startChunk(),
        textStartChunk(0),
        textChunk(0, "Hello"),
        textChunk(0, " world"),
        textCompleteChunk(0),
        completeChunk(),
      ];

      const provider = makeProvider({ streamChunks: [chunks] });
      const { events, callback } = collectEvents();

      const result = stream({ provider, model: "test-model", messages: [] });
      result.on(callback);

      const final = await result.final;

      expect(final.result).toBe("success");
      if (final.result !== "success") return;

      expect(final.messages).toHaveLength(1);
      expect(final.messages[0].role).toBe("assistant");

      const starts = events.filter((e) => e.type === "text:start");
      expect(starts).toHaveLength(1);
      expect(starts[0].type === "text:start" && starts[0].index).toBe(0);

      const deltas = events.filter((e) => e.type === "text:delta");
      expect(deltas).toHaveLength(2);
      expect(deltas[0].type === "text:delta" && deltas[0].delta).toBe("Hello");
      expect(deltas[0].type === "text:delta" && deltas[0].accumulated).toBe("Hello");
      expect(deltas[1].type === "text:delta" && deltas[1].delta).toBe(" world");
      expect(deltas[1].type === "text:delta" && deltas[1].accumulated).toBe("Hello world");

      const ends = events.filter((e) => e.type === "text:end");
      expect(ends).toHaveLength(1);
      expect(ends[0].type === "text:end" && ends[0].index).toBe(0);
      expect(ends[0].type === "text:end" && ends[0].final).toBe("Hello world");
    });

    test("handles thinking + text parts", async () => {
      const chunks: AnyStreamChunk[] = [
        startChunk(),
        thinkingStartChunk(0),
        thinkingDeltaChunk(0, "Let me think"),
        thinkingCompleteChunk(0),
        textStartChunk(1),
        textChunk(1, "Answer"),
        textCompleteChunk(1),
        completeChunk(),
      ];

      const provider = makeProvider({ streamChunks: [chunks] });
      const { events, callback } = collectEvents();

      const result = stream({ provider, model: "test-model", messages: [] });
      result.on(callback);

      const final = await result.final;
      expect(final.result).toBe("success");

      const thinkingStarts = events.filter((e) => e.type === "thinking:start");
      expect(thinkingStarts).toHaveLength(1);
      expect(thinkingStarts[0].type === "thinking:start" && thinkingStarts[0].index).toBe(0);

      const textStarts = events.filter((e) => e.type === "text:start");
      expect(textStarts).toHaveLength(1);
      expect(textStarts[0].type === "text:start" && textStarts[0].index).toBe(1);

      const thinkingEnds = events.filter((e) => e.type === "thinking:end");
      expect(thinkingEnds).toHaveLength(1);
      expect(thinkingEnds[0].type === "thinking:end" && thinkingEnds[0].index).toBe(0);

      const textEnds = events.filter((e) => e.type === "text:end");
      expect(textEnds).toHaveLength(1);
      expect(textEnds[0].type === "text:end" && textEnds[0].index).toBe(1);
    });
  });

  describe("with tool calls", () => {
    test("full tool call cycle with correct messages", async () => {
      // First LLM turn: thinking + tool call
      const turn1Chunks: AnyStreamChunk[] = [
        startChunk("msg_1"),
        thinkingStartChunk(0),
        thinkingDeltaChunk(0, "I need to search"),
        thinkingCompleteChunk(0),
        toolCallStartChunk(1, "call_1", "web_search"),
        toolCallCompleteChunk(1, "call_1", "web_search", { q: "test" }),
        completeChunk(AxleStopReason.FunctionCall),
      ];

      // Second LLM turn: text response
      const turn2Chunks: AnyStreamChunk[] = [
        startChunk("msg_2"),
        textStartChunk(0),
        textChunk(0, "Here are the results"),
        textCompleteChunk(0),
        completeChunk(),
      ];

      const provider = makeProvider({ streamChunks: [turn1Chunks, turn2Chunks] });
      const { events, callback } = collectEvents();

      const result = stream({
        provider,
        model: "test-model",
        messages: [],
        onToolCall: async (name, parameters) => {
          expect(name).toBe("web_search");
          expect(parameters).toEqual({ q: "test" });
          return { type: "success", content: "search results here" };
        },
      });
      result.on(callback);

      const final = await result.final;

      expect(final.result).toBe("success");
      if (final.result !== "success") return;

      // Messages: assistant (turn 1), tool results, assistant (turn 2)
      expect(final.messages).toHaveLength(3);
      expect(final.messages[0].role).toBe("assistant");
      expect(final.messages[1].role).toBe("tool");
      expect(final.messages[2].role).toBe("assistant");

      expect(events.filter((e) => e.type === "thinking:start")).toHaveLength(1);
      expect(events.filter((e) => e.type === "thinking:end")).toHaveLength(1);
      expect(events.filter((e) => e.type === "text:start")).toHaveLength(1);
      expect(events.filter((e) => e.type === "text:end")).toHaveLength(1);
    });

    test("emits tool:start, tool:execute, tool:complete events", async () => {
      const turn1Chunks: AnyStreamChunk[] = [
        startChunk("msg_1"),
        toolCallStartChunk(0, "call_1", "web_search"),
        toolCallCompleteChunk(0, "call_1", "web_search", { q: "test" }),
        completeChunk(AxleStopReason.FunctionCall),
      ];

      const turn2Chunks: AnyStreamChunk[] = [
        startChunk("msg_2"),
        textStartChunk(0),
        textChunk(0, "Done"),
        textCompleteChunk(0),
        completeChunk(),
      ];

      const provider = makeProvider({ streamChunks: [turn1Chunks, turn2Chunks] });
      const { events, callback } = collectEvents();

      const result = stream({
        provider,
        model: "test-model",
        messages: [],
        onToolCall: async () => ({ type: "success", content: "ok" }),
      });
      result.on(callback);

      await result.final;

      const toolStarts = events.filter((e) => e.type === "tool:start");
      expect(toolStarts).toHaveLength(1);
      expect(toolStarts[0].type === "tool:start" && toolStarts[0].id).toBe("call_1");
      expect(toolStarts[0].type === "tool:start" && toolStarts[0].name).toBe("web_search");
      expect(toolStarts[0].type === "tool:start" && toolStarts[0].index).toBe(0);

      const toolExecute = events.filter((e) => e.type === "tool:execute");
      expect(toolExecute).toHaveLength(1);
      expect(toolExecute[0].type === "tool:execute" && toolExecute[0].name).toBe("web_search");
      expect(toolExecute[0].type === "tool:execute" && toolExecute[0].parameters).toEqual({ q: "test" });
      expect(toolExecute[0].type === "tool:execute" && toolExecute[0].index).toBe(0);

      const toolComplete = events.filter((e) => e.type === "tool:complete");
      expect(toolComplete).toHaveLength(1);
      expect(toolComplete[0].type === "tool:complete" && toolComplete[0].result).toEqual({
        type: "success",
        content: "ok",
      });
    });
  });

  describe("tool not found", () => {
    test("reports not-found as tool error result and continues loop", async () => {
      const toolCallChunks: AnyStreamChunk[] = [
        startChunk(),
        toolCallStartChunk(0, "call_1", "unknown_tool"),
        toolCallCompleteChunk(0, "call_1", "unknown_tool", {}),
        completeChunk(AxleStopReason.FunctionCall),
      ];

      // After the tool error, the LLM responds with text
      const followUpChunks: AnyStreamChunk[] = [
        startChunk(),
        textStartChunk(0),
        textChunk(0, "Sorry, that tool doesn't exist."),
        textCompleteChunk(0),
        completeChunk(AxleStopReason.Stop),
      ];

      const provider = makeProvider({ streamChunks: [toolCallChunks, followUpChunks] });

      const handle = stream({
        provider,
        model: "test-model",
        messages: [],
        onToolCall: async () => null,
      });

      const final = await handle.final;

      expect(final.result).toBe("success");
      // Messages should include: assistant (tool call), tool (error result), assistant (follow-up)
      const toolMessage = final.messages.find((m) => m.role === "tool");
      expect(toolMessage).toBeDefined();
      if (toolMessage?.role === "tool") {
        expect(toolMessage.content[0].isError).toBe(true);
        expect(toolMessage.content[0].content).toContain("not-found");
      }
    });
  });

  describe("max iterations exceeded", () => {
    test("returns error when maxIterations is reached", async () => {
      const provider = makeProvider({ streamChunks: [] });

      const result = stream({ provider, model: "test-model", messages: [], maxIterations: 0 });

      const final = await result.final;

      expect(final.result).toBe("error");
      if (final.result !== "error") return;
      expect(final.error.type).toBe("model");
    });
  });

  describe("provider error", () => {
    test("returns error on stream error chunk", async () => {
      const chunks: AnyStreamChunk[] = [
        startChunk(),
        errorChunk("rate_limit", "Too many requests"),
      ];

      const provider = makeProvider({ streamChunks: [chunks] });

      const result = stream({ provider, model: "test-model", messages: [] });

      const final = await result.final;

      expect(final.result).toBe("error");
      if (final.result !== "error") return;
      expect(final.error.type).toBe("model");
    });
  });

  describe("non-streaming provider", () => {
    test("throws when provider has no createStreamingRequest", async () => {
      const provider = makeProvider({ supportsStreaming: false });

      const result = stream({ provider, model: "test-model", messages: [] });

      await expect(result.final).rejects.toThrow("Provider does not support streaming");
    });
  });

  describe("callback ordering", () => {
    test("text:start fires before text:delta, text:delta fires before text:end", async () => {
      const chunks: AnyStreamChunk[] = [
        startChunk(),
        textStartChunk(0),
        textChunk(0, "Hello"),
        textCompleteChunk(0),
        completeChunk(),
      ];

      const provider = makeProvider({ streamChunks: [chunks] });
      const order: string[] = [];

      const result = stream({ provider, model: "test-model", messages: [] });
      result.on((event) => {
        switch (event.type) {
          case "text:start":
            order.push(`text:start:${event.index}`);
            break;
          case "text:delta":
            order.push(`text:delta:${event.index}`);
            break;
          case "text:end":
            order.push(`text:end:${event.index}`);
            break;
        }
      });

      await result.final;

      expect(order).toEqual(["text:start:0", "text:delta:0", "text:end:0"]);
    });
  });

  describe("global index", () => {
    test("index increments across LLM turns including tool calls", async () => {
      // Turn 1: text(0) + tool-call(1) → Turn 2: text(2)
      const turn1: AnyStreamChunk[] = [
        startChunk("msg_1"),
        textStartChunk(0),
        textChunk(0, "thinking..."),
        textCompleteChunk(0),
        toolCallStartChunk(1, "call_1", "search"),
        toolCallCompleteChunk(1, "call_1", "search", { q: "x" }),
        completeChunk(AxleStopReason.FunctionCall),
      ];

      const turn2: AnyStreamChunk[] = [
        startChunk("msg_2"),
        textStartChunk(0),
        textChunk(0, "done"),
        textCompleteChunk(0),
        completeChunk(),
      ];

      const provider = makeProvider({ streamChunks: [turn1, turn2] });
      const startIndices: number[] = [];
      const endIndices: number[] = [];

      const result = stream({
        provider,
        model: "test-model",
        messages: [],
        onToolCall: async () => ({ type: "success", content: "ok" }),
      });
      result.on((event) => {
        if (event.type === "text:start") startIndices.push(event.index);
        if (event.type === "text:end") endIndices.push(event.index);
      });

      await result.final;

      // text(0), tool-call increments to 1, turn 2 text starts at 2
      expect(startIndices).toEqual([0, 2]);
      expect(endIndices).toEqual([0, 2]);
    });
  });

  describe("usage tracking", () => {
    test("accumulates usage across multiple turns", async () => {
      const turn1: AnyStreamChunk[] = [
        startChunk("msg_1"),
        toolCallStartChunk(0, "call_1", "search"),
        toolCallCompleteChunk(0, "call_1", "search", {}),
        completeChunk(AxleStopReason.FunctionCall, { in: 10, out: 5 }),
      ];

      const turn2: AnyStreamChunk[] = [
        startChunk("msg_2"),
        textStartChunk(0),
        textChunk(0, "done"),
        textCompleteChunk(0),
        completeChunk(AxleStopReason.Stop, { in: 15, out: 10 }),
      ];

      const provider = makeProvider({ streamChunks: [turn1, turn2] });

      const result = stream({
        provider,
        model: "test-model",
        messages: [],
        onToolCall: async () => ({ type: "success", content: "ok" }),
      });

      const final = await result.final;

      expect(final.usage).toBeDefined();
      expect(final.usage!.in).toBe(25);
      expect(final.usage!.out).toBe(15);
    });
  });

  describe("cancellation", () => {
    test("cancel before content — no partial", async () => {
      let yieldControl!: () => void;
      const gate = new Promise<void>((resolve) => {
        yieldControl = resolve;
      });

      const provider = makeProvider({
        streamFactory: async function* () {
          await gate;
          yield startChunk();
          yield textStartChunk(0);
          yield textChunk(0, "Hello");
          yield textCompleteChunk(0);
          yield completeChunk();
        },
      });

      const handle = stream({ provider, model: "test-model", messages: [] });
      handle.cancel();
      yieldControl();

      const final = await handle.final;
      expect(final.result).toBe("cancelled");
      if (final.result !== "cancelled") return;
      expect(final.partial).toBeUndefined();
      expect(final.messages).toHaveLength(0);
    });

    test("cancel mid-stream — partial with accumulated text", async () => {
      let yieldControl!: () => void;
      const gate = new Promise<void>((resolve) => {
        yieldControl = resolve;
      });

      const provider = makeProvider({
        streamFactory: async function* () {
          yield startChunk();
          yield textStartChunk(0);
          yield textChunk(0, "Hello");
          yield textChunk(0, " world");
          await gate;
          yield textCompleteChunk(0);
          yield completeChunk();
        },
      });

      const handle = stream({ provider, model: "test-model", messages: [] });

      // Wait a tick so the generator processes chunks before the gate
      await new Promise((r) => setTimeout(r, 10));
      handle.cancel();
      yieldControl();

      const final = await handle.final;
      expect(final.result).toBe("cancelled");
      if (final.result !== "cancelled") return;
      expect(final.partial).toBeDefined();
      expect(final.partial!.content).toHaveLength(1);
      expect((final.partial!.content[0] as any).text).toBe("Hello world");
      expect(final.partial!.finishReason).toBe(AxleStopReason.Cancelled);
      // Partial is also included in messages
      expect(final.messages).toHaveLength(1);
      expect(final.messages[0].role).toBe("assistant");
    });

    test("cancel between turns — completed messages, no partial", async () => {
      let cancelHandle!: () => void;
      let turn2Gate!: () => void;
      const turn2Promise = new Promise<void>((resolve) => {
        turn2Gate = resolve;
      });

      const turn1Chunks: AnyStreamChunk[] = [
        startChunk("msg_1"),
        toolCallStartChunk(0, "call_1", "search"),
        toolCallCompleteChunk(0, "call_1", "search", { q: "test" }),
        completeChunk(AxleStopReason.FunctionCall, { in: 10, out: 5 }),
      ];

      let callIndex = 0;
      const provider = makeProvider({
        streamFactory: async function* () {
          if (callIndex === 0) {
            callIndex++;
            for (const chunk of turn1Chunks) yield chunk;
          } else {
            await turn2Promise;
            yield startChunk("msg_2");
            yield textStartChunk(0);
            yield textChunk(0, "done");
            yield textCompleteChunk(0);
            yield completeChunk();
          }
        },
      });

      const handle = stream({
        provider,
        model: "test-model",
        messages: [],
        onToolCall: async () => {
          // Cancel after tool execution completes but before turn 2 starts
          setTimeout(() => {
            cancelHandle();
          }, 5);
          return { type: "success", content: "results" };
        },
      });
      cancelHandle = () => handle.cancel();

      // Let the turn 2 gate open after cancel is processed
      await new Promise((r) => setTimeout(r, 20));
      turn2Gate();

      const final = await handle.final;
      expect(final.result).toBe("cancelled");
      if (final.result !== "cancelled") return;
      // Turn 1 assistant + tool results should be in messages
      expect(final.messages).toHaveLength(2);
      expect(final.messages[0].role).toBe("assistant");
      expect(final.messages[1].role).toBe("tool");
      expect(final.partial).toBeUndefined();
      // Usage should include turn 1 only
      expect(final.usage.in).toBe(10);
      expect(final.usage.out).toBe(5);
    });

    test("cancel after completion is a no-op", async () => {
      const chunks: AnyStreamChunk[] = [
        startChunk(),
        textStartChunk(0),
        textChunk(0, "Hello"),
        textCompleteChunk(0),
        completeChunk(),
      ];

      const provider = makeProvider({ streamChunks: [chunks] });
      const handle = stream({ provider, model: "test-model", messages: [] });

      const final = await handle.final;
      expect(final.result).toBe("success");

      // Should not throw
      handle.cancel();
      handle.cancel();

      // Result unchanged
      const final2 = await handle.final;
      expect(final2.result).toBe("success");
    });

    test("cancel is idempotent — multiple calls do not throw", async () => {
      let yieldControl!: () => void;
      const gate = new Promise<void>((resolve) => {
        yieldControl = resolve;
      });

      const provider = makeProvider({
        streamFactory: async function* () {
          await gate;
          yield startChunk();
          yield textStartChunk(0);
          yield textChunk(0, "Hello");
          yield textCompleteChunk(0);
          yield completeChunk();
        },
      });

      const handle = stream({ provider, model: "test-model", messages: [] });

      handle.cancel();
      handle.cancel();
      handle.cancel();
      yieldControl();

      const final = await handle.final;
      expect(final.result).toBe("cancelled");
    });

    test("usage only includes completed turns", async () => {
      let yieldControl!: () => void;
      const gate = new Promise<void>((resolve) => {
        yieldControl = resolve;
      });

      const turn1Chunks: AnyStreamChunk[] = [
        startChunk("msg_1"),
        toolCallStartChunk(0, "call_1", "search"),
        toolCallCompleteChunk(0, "call_1", "search", {}),
        completeChunk(AxleStopReason.FunctionCall, { in: 10, out: 5 }),
      ];

      let callIndex = 0;
      const provider = makeProvider({
        streamFactory: async function* () {
          if (callIndex === 0) {
            callIndex++;
            for (const chunk of turn1Chunks) yield chunk;
          } else {
            yield startChunk("msg_2");
            yield textStartChunk(0);
            yield textChunk(0, "partial");
            await gate;
            yield textCompleteChunk(0);
            yield completeChunk(AxleStopReason.Stop, { in: 20, out: 15 });
          }
        },
      });

      const handle = stream({
        provider,
        model: "test-model",
        messages: [],
        onToolCall: async () => ({ type: "success", content: "ok" }),
      });

      // Wait for turn 2 to start streaming
      await new Promise((r) => setTimeout(r, 20));
      handle.cancel();
      yieldControl();

      const final = await handle.final;
      expect(final.result).toBe("cancelled");
      if (final.result !== "cancelled") return;
      // Messages: turn 1 assistant + tool results + partial turn 2 assistant
      expect(final.messages).toHaveLength(3);
      expect(final.messages[0].role).toBe("assistant");
      expect(final.messages[1].role).toBe("tool");
      expect(final.messages[2].role).toBe("assistant");
      // Usage should only include turn 1 (completed)
      expect(final.usage.in).toBe(10);
      expect(final.usage.out).toBe(5);
    });
  });
});
