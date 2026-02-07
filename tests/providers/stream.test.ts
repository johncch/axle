import { describe, expect, test } from "vitest";
import type {
  AnyStreamChunk,
  StreamCompleteChunk,
  StreamErrorChunk,
  StreamStartChunk,
  StreamTextChunk,
  StreamThinkingDeltaChunk,
  StreamThinkingStartChunk,
  StreamToolCallCompleteChunk,
  StreamToolCallStartChunk,
} from "../../src/messages/streaming/types.js";
import {
  stream,
  type PartEndCallback,
  type PartUpdateCallback,
  type StreamPartType,
} from "../../src/providers/stream.js";
import type { AIProvider } from "../../src/providers/types.js";
import { AxleStopReason } from "../../src/providers/types.js";

// --- Helpers ---

function makeProvider(opts: {
  streamChunks?: AnyStreamChunk[][];
  supportsStreaming?: boolean;
}): AIProvider {
  const { streamChunks, supportsStreaming = true } = opts;
  let streamCallIndex = 0;

  const provider: AIProvider = {
    get name() {
      return "test";
    },
    get model() {
      return "test-model";
    },
    async createGenerationRequest() {
      throw new Error("Not implemented");
    },
  };

  if (supportsStreaming && streamChunks) {
    provider.createStreamingRequest = function* () {
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

function textChunk(index: number, text: string): StreamTextChunk {
  return { type: "text", data: { index, text } };
}

function thinkingStartChunk(index: number): StreamThinkingStartChunk {
  return { type: "thinking-start", data: { index } };
}

function thinkingDeltaChunk(index: number, text: string): StreamThinkingDeltaChunk {
  return { type: "thinking-delta", data: { index, text } };
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

type EventLog = { event: string; index: number; type: StreamPartType; data: unknown };

function collectEvents() {
  const events: EventLog[] = [];

  const onPartUpdate: PartUpdateCallback = (index, type, delta, accumulated) => {
    events.push({ event: "partUpdate", index, type, data: { delta, accumulated } });
  };

  const onPartEnd: PartEndCallback = (index, type, final) => {
    events.push({ event: "partEnd", index, type, data: final });
  };

  return { events, onPartUpdate, onPartEnd };
}

// --- Tests ---

describe("stream()", () => {
  describe("no tool calls — text only", () => {
    test("forwards text chunks and returns success", async () => {
      const chunks: AnyStreamChunk[] = [
        startChunk(),
        textChunk(0, "Hello"),
        textChunk(0, " world"),
        completeChunk(),
      ];

      const provider = makeProvider({ streamChunks: [chunks] });
      const { events, onPartUpdate, onPartEnd } = collectEvents();

      const result = stream({ provider, messages: [] });
      result.onPartUpdate(onPartUpdate);
      result.onPartEnd(onPartEnd);

      const final = await result.final;

      expect(final.result).toBe("success");
      if (final.result !== "success") return;

      expect(final.messages).toHaveLength(1);
      expect(final.messages[0].role).toBe("assistant");

      const updates = events.filter((e) => e.event === "partUpdate");
      expect(updates).toHaveLength(2);
      expect(updates[0].index).toBe(0);
      expect((updates[0].data as any).delta).toBe("Hello");
      expect((updates[0].data as any).accumulated).toBe("Hello");
      expect(updates[1].index).toBe(0);
      expect((updates[1].data as any).delta).toBe(" world");
      expect((updates[1].data as any).accumulated).toBe("Hello world");

      const partEnds = events.filter((e) => e.event === "partEnd");
      expect(partEnds).toHaveLength(1);
      expect(partEnds[0].index).toBe(0);
      expect(partEnds[0].type).toBe("text");
      expect(partEnds[0].data).toBe("Hello world");
    });

    test("handles thinking + text parts", async () => {
      const chunks: AnyStreamChunk[] = [
        startChunk(),
        thinkingStartChunk(0),
        thinkingDeltaChunk(0, "Let me think"),
        textChunk(1, "Answer"),
        completeChunk(),
      ];

      const provider = makeProvider({ streamChunks: [chunks] });
      const { events, onPartUpdate, onPartEnd } = collectEvents();

      const result = stream({ provider, messages: [] });
      result.onPartUpdate(onPartUpdate);
      result.onPartEnd(onPartEnd);

      const final = await result.final;
      expect(final.result).toBe("success");

      const partEnds = events.filter((e) => e.event === "partEnd");
      expect(partEnds).toHaveLength(2);
      expect(partEnds[0].type).toBe("thinking");
      expect(partEnds[0].index).toBe(0);
      expect(partEnds[1].type).toBe("text");
      expect(partEnds[1].index).toBe(1);
    });
  });

  describe("with tool calls", () => {
    test("full tool call cycle with correct indices and message grouping", async () => {
      // First LLM turn: thinking + tool call
      const turn1Chunks: AnyStreamChunk[] = [
        startChunk("msg_1"),
        thinkingStartChunk(0),
        thinkingDeltaChunk(0, "I need to search"),
        toolCallStartChunk(1, "call_1", "web_search"),
        toolCallCompleteChunk(1, "call_1", "web_search", { q: "test" }),
        completeChunk(AxleStopReason.FunctionCall),
      ];

      // Second LLM turn: text response
      const turn2Chunks: AnyStreamChunk[] = [
        startChunk("msg_2"),
        textChunk(0, "Here are the results"),
        completeChunk(),
      ];

      const provider = makeProvider({ streamChunks: [turn1Chunks, turn2Chunks] });
      const { events, onPartUpdate, onPartEnd } = collectEvents();

      const result = stream({
        provider,
        messages: [],
        onToolCall: async (name, parameters) => {
          expect(name).toBe("web_search");
          expect(parameters).toEqual({ q: "test" });
          return { type: "success", content: "search results here" };
        },
      });
      result.onPartUpdate(onPartUpdate);
      result.onPartEnd(onPartEnd);

      const final = await result.final;

      expect(final.result).toBe("success");
      if (final.result !== "success") return;

      // Messages: assistant (turn 1), tool results, assistant (turn 2)
      expect(final.messages).toHaveLength(3);
      expect(final.messages[0].role).toBe("assistant");
      expect(final.messages[1].role).toBe("tool");
      expect(final.messages[2].role).toBe("assistant");

      // Check global index progression
      const partEnds = events.filter((e) => e.event === "partEnd");
      // thinking(0), tool-call(1), tool-result(2), text(3)
      expect(partEnds.map((e) => e.index)).toEqual([0, 1, 2, 3]);
      expect(partEnds.map((e) => e.type)).toEqual(["thinking", "tool-call", "tool-result", "text"]);
    });
  });

  describe("tool not found", () => {
    test("returns error when onToolCall returns null", async () => {
      const chunks: AnyStreamChunk[] = [
        startChunk(),
        toolCallStartChunk(0, "call_1", "unknown_tool"),
        toolCallCompleteChunk(0, "call_1", "unknown_tool", {}),
        completeChunk(AxleStopReason.FunctionCall),
      ];

      const provider = makeProvider({ streamChunks: [chunks] });

      const result = stream({ provider, messages: [], onToolCall: async () => null });

      const final = await result.final;

      expect(final.result).toBe("error");
      if (final.result !== "error") return;
      expect(final.error.type).toBe("tool");
      if (final.error.type === "tool") {
        expect(final.error.error.name).toBe("unknown_tool");
      }
    });
  });

  describe("max iterations exceeded", () => {
    test("returns error when maxIterations is reached", async () => {
      const provider = makeProvider({ streamChunks: [] });

      const result = stream({ provider, messages: [], maxIterations: 0 });

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

      const result = stream({ provider, messages: [] });

      const final = await result.final;

      expect(final.result).toBe("error");
      if (final.result !== "error") return;
      expect(final.error.type).toBe("model");
    });
  });

  describe("non-streaming provider", () => {
    test("throws when provider has no createStreamingRequest", async () => {
      const provider = makeProvider({ supportsStreaming: false });

      const result = stream({ provider, messages: [] });

      await expect(result.final).rejects.toThrow("Provider does not support streaming");
    });
  });

  describe("callback ordering", () => {
    test("onPartUpdate fires before onPartEnd for each part", async () => {
      const chunks: AnyStreamChunk[] = [startChunk(), textChunk(0, "Hello"), completeChunk()];

      const provider = makeProvider({ streamChunks: [chunks] });
      const order: string[] = [];

      const result = stream({ provider, messages: [] });
      result.onPartUpdate((index, type) => {
        order.push(`partUpdate:${index}:${type}`);
      });
      result.onPartEnd((index, type) => {
        order.push(`partEnd:${index}:${type}`);
      });

      await result.final;

      expect(order).toEqual(["partUpdate:0:text", "partEnd:0:text"]);
    });
  });

  describe("global index", () => {
    test("index increments across LLM turns and tool results", async () => {
      // Turn 1: text(0) + tool-call(1) → tool-result(2) → Turn 2: text(3)
      const turn1: AnyStreamChunk[] = [
        startChunk("msg_1"),
        textChunk(0, "thinking..."),
        toolCallStartChunk(1, "call_1", "search"),
        toolCallCompleteChunk(1, "call_1", "search", { q: "x" }),
        completeChunk(AxleStopReason.FunctionCall),
      ];

      const turn2: AnyStreamChunk[] = [startChunk("msg_2"), textChunk(0, "done"), completeChunk()];

      const provider = makeProvider({ streamChunks: [turn1, turn2] });
      const indices: number[] = [];

      const result = stream({
        provider,
        messages: [],
        onToolCall: async () => ({ type: "success", content: "ok" }),
      });
      result.onPartEnd((index) => {
        indices.push(index);
      });

      await result.final;

      expect(indices).toEqual([0, 1, 2, 3]);
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
        textChunk(0, "done"),
        completeChunk(AxleStopReason.Stop, { in: 15, out: 10 }),
      ];

      const provider = makeProvider({ streamChunks: [turn1, turn2] });

      const result = stream({
        provider,
        messages: [],
        onToolCall: async () => ({ type: "success", content: "ok" }),
      });

      const final = await result.final;

      expect(final.usage).toBeDefined();
      expect(final.usage!.in).toBe(25);
      expect(final.usage!.out).toBe(15);
    });
  });
});
