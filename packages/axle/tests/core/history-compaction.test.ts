import { describe, expect, test } from "vitest";
import { Agent, History } from "../../src/core/agent/index.js";
import { AxleAbortError } from "../../src/errors/AxleAbortError.js";
import type { CompactionRecord } from "../../src/messages/compaction.js";
import { validateCompactedMessages } from "../../src/messages/compaction.js";
import type {
  AxleAssistantMessage,
  AxleMessage,
  AxleToolCallMessage,
  AxleUserMessage,
} from "../../src/messages/message.js";
import type { AnyStreamChunk } from "../../src/messages/stream.js";
import type { SpanData } from "../../src/observability/index.js";
import { Tracer } from "../../src/observability/index.js";
import type { AIProvider } from "../../src/providers/types.js";
import { AxleStopReason } from "../../src/providers/types.js";
import { TurnAccumulator } from "../../src/turns/accumulator.js";
import type { TurnEvent } from "../../src/turns/events.js";
import type { Turn } from "../../src/turns/types.js";

function isCompactionTurn(turn: Turn): boolean {
  return turn.parts.some((part) => part.type === "compaction");
}

function user(text: string): AxleUserMessage {
  return { role: "user", content: text };
}

function assistant(id: string, text: string): AxleAssistantMessage {
  return { role: "assistant", id, content: [{ type: "text", text }] };
}

function assistantToolCall(id: string, toolCallId: string): AxleAssistantMessage {
  return {
    role: "assistant",
    id,
    content: [{ type: "tool-call", id: toolCallId, name: "lookup", parameters: {} }],
  };
}

function toolResult(id: string, toolCallId: string): AxleToolCallMessage {
  return {
    role: "tool",
    id,
    content: [{ id: toolCallId, name: "lookup", content: "result" }],
  };
}

function record(id: string): CompactionRecord {
  return { id, at: "2026-07-03T00:00:00.000Z" };
}

const FOUR_MESSAGES: AxleMessage[] = [
  user("one"),
  assistant("a1", "two"),
  user("three"),
  assistant("a2", "four"),
];

describe("History", () => {
  test("state is not modifiable through reads", () => {
    const history = new History({ messages: FOUR_MESSAGES });
    history.messages.push(user("sneaky"));
    history.turns.push({ id: "t1", owner: "user", parts: [], status: "complete" });

    expect(history.messages).toHaveLength(4);
    expect(history.turns).toHaveLength(0);
  });

  test("append writes to both the active conversation and the archive", () => {
    const history = new History();
    history.append(FOUR_MESSAGES);
    history.append(user("five"));

    expect(history.messages).toHaveLength(5);
    expect(history.archive).toHaveLength(5);
  });

  test("compact swaps the active conversation and keeps the record; archive and turns untouched", () => {
    const history = new History({
      turns: [{ id: "t1", owner: "user", parts: [], status: "complete" }],
    });
    history.append(FOUR_MESSAGES);
    const summary = [user("summary of one through four")];
    history.compact(summary, record("c1"));

    expect(history.messages).toEqual(summary);
    expect(history.archive).toEqual(FOUR_MESSAGES);
    expect(history.compactions.map((r) => r.id)).toEqual(["c1"]);
    expect(history.turns).toHaveLength(1);
  });

  test("a session without an archive seeds it from the restored messages", () => {
    const history = new History({ messages: FOUR_MESSAGES });
    expect(history.archive).toEqual(FOUR_MESSAGES);

    history.compact([user("summary")], record("c1"));
    expect(history.messages).toEqual([user("summary")]);
    expect(history.archive).toEqual(FOUR_MESSAGES);
  });

  test("an explicit archive is used as-is, not reseeded", () => {
    const archive = [...FOUR_MESSAGES, user("pre-compaction detail")];
    const history = new History({ messages: [user("summary")], archive });
    expect(history.archive).toEqual(archive);
  });

  test("across two compactions the archive holds every appended message, no summaries", () => {
    const history = new History();
    history.append(FOUR_MESSAGES);
    history.compact([user("first summary")], record("c1"));
    history.append(user("five"));
    history.compact([user("second summary")], record("c2"));

    expect(history.messages).toEqual([user("second summary")]);
    expect(history.archive).toEqual([...FOUR_MESSAGES, user("five")]);
    expect(history.compactions.map((r) => r.id)).toEqual(["c1", "c2"]);
  });
});

describe("validateCompactedMessages", () => {
  test("accepts empty and plain conversations", () => {
    expect(() => validateCompactedMessages([])).not.toThrow();
    expect(() => validateCompactedMessages(FOUR_MESSAGES)).not.toThrow();
  });

  test("accepts a paired tool call and result", () => {
    expect(() =>
      validateCompactedMessages([
        user("do it"),
        assistantToolCall("a1", "tc1"),
        toolResult("t1", "tc1"),
        assistant("a2", "done"),
      ]),
    ).not.toThrow();
  });

  test("rejects a tool result with no preceding call", () => {
    expect(() => validateCompactedMessages([user("hi"), toolResult("t1", "tc1")])).toThrowError(
      /no preceding tool call/,
    );
  });

  test("rejects an unanswered tool call at the end of the sequence", () => {
    expect(() => validateCompactedMessages([assistantToolCall("a1", "tc1")])).toThrowError(
      /unanswered tool calls: tc1/,
    );
  });

  test("rejects a message interleaved between a tool call and its result", () => {
    expect(() =>
      validateCompactedMessages([
        assistantToolCall("a1", "tc1"),
        user("context note"),
        toolResult("t1", "tc1"),
      ]),
    ).toThrowError(/interleave a "user" message/);
    expect(() =>
      validateCompactedMessages([assistantToolCall("a1", "tc1"), assistant("a2", "text")]),
    ).toThrowError(/interleave an? "assistant" message/);
  });

  test("accepts consecutive tool messages answering one call batch", () => {
    expect(() =>
      validateCompactedMessages([
        {
          role: "assistant",
          id: "a1",
          content: [
            { type: "tool-call", id: "tc1", name: "lookup", parameters: {} },
            { type: "tool-call", id: "tc2", name: "lookup", parameters: {} },
          ],
        },
        toolResult("t1", "tc1"),
        toolResult("t2", "tc2"),
      ]),
    ).not.toThrow();
  });

  test("rejects a repeated unanswered tool call id", () => {
    expect(() =>
      validateCompactedMessages([
        {
          role: "assistant",
          id: "a1",
          content: [
            { type: "tool-call", id: "tc1", name: "lookup", parameters: {} },
            { type: "tool-call", id: "tc1", name: "lookup", parameters: {} },
          ],
        },
        toolResult("t1", "tc1"),
      ]),
    ).toThrowError(/repeat unanswered tool call id/);
  });

  test("rejects an unknown role", () => {
    expect(() =>
      validateCompactedMessages([{ role: "system", content: "nope" } as any]),
    ).toThrowError(/unknown role/);
  });
});

function createCapturingProvider(): { provider: AIProvider; requests: AxleMessage[][] } {
  const requests: AxleMessage[][] = [];
  const provider: AIProvider = {
    name: "mock-capture",
    async createGenerationRequest() {
      throw new Error("not used");
    },
    async *createStreamingRequest(_model, { messages }): AsyncGenerator<AnyStreamChunk, void> {
      requests.push([...messages]);
      yield { type: "start", id: "mock-1", data: { model: "mock", timestamp: 0 } };
      yield { type: "text-start", data: { index: 0 } };
      yield { type: "text-delta", data: { index: 0, text: "ok" } };
      yield { type: "text-complete", data: { index: 0 } };
      yield {
        type: "complete",
        data: { finishReason: AxleStopReason.Stop, usage: { in: 1, out: 1 } },
      };
    },
  };
  return { provider, requests };
}

describe("Agent.compact", () => {
  test("runs the callback, updates history, and emits compaction events", async () => {
    const { provider } = createCapturingProvider();
    const agent = new Agent({ provider, model: "mock" });
    agent.history.append(FOUR_MESSAGES);

    const events: TurnEvent[] = [];
    agent.on((event) => events.push(event));

    const summary = [user("summary of the first four")];
    agent.onCompaction((state, context) => {
      expect(state.messages).toHaveLength(4);
      expect(context.usage.total).toBeGreaterThan(0);
      return summary;
    });

    const result = await agent.compact();

    expect(typeof result?.at).toBe("string");

    expect(agent.history.messages).toEqual(summary);
    expect(agent.history.archive).toEqual(FOUR_MESSAGES);
    expect(agent.history.compactions).toEqual([result]);

    expect(events.map((e) => e.type)).toEqual(["compaction:start", "compaction:end"]);

    const entries = agent.history.turns.filter(isCompactionTurn);
    expect(entries).toHaveLength(1);
    expect(entries[0].owner).toBe("agent");
    expect(entries[0].status).toBe("complete");
    const part = entries[0].parts[0];
    expect(part.type === "compaction" && part.record).toEqual(result);
  });

  test("a null return skips: no state change, no lasting turns entry", async () => {
    const { provider } = createCapturingProvider();
    const agent = new Agent({ provider, model: "mock" });
    agent.history.append(FOUR_MESSAGES);
    agent.onCompaction(() => null);

    const events: TurnEvent[] = [];
    agent.on((event) => events.push(event));

    const result = await agent.compact();

    expect(result).toBeNull();
    expect(agent.history.messages).toEqual(FOUR_MESSAGES);
    expect(agent.history.archive).toEqual(FOUR_MESSAGES);
    expect(agent.history.compactions).toEqual([]);
    expect(events.map((e) => e.type)).toEqual(["compaction:start", "compaction:end"]);
    expect(agent.history.turns.filter(isCompactionTurn)).toEqual([]);
  });

  test("is a no-op without a registered callback", async () => {
    const { provider } = createCapturingProvider();
    const agent = new Agent({ provider, model: "mock" });
    agent.history.append(FOUR_MESSAGES);
    const events: TurnEvent[] = [];
    agent.on((event) => events.push(event));

    await expect(agent.compact()).resolves.toBeNull();
    expect(events).toEqual([]);
    expect(agent.history.turns).toEqual([]);
    expect(agent.history.messages).toEqual(FOUR_MESSAGES);
  });

  test("an invalid result throws, leaves state untouched, and marks the entry errored", async () => {
    const { provider } = createCapturingProvider();
    const agent = new Agent({ provider, model: "mock" });
    agent.history.append(FOUR_MESSAGES);
    agent.onCompaction(() => [assistantToolCall("a1", "tc1")]);

    await expect(agent.compact()).rejects.toThrowError(/unanswered tool calls/);
    expect(agent.history.messages).toEqual(FOUR_MESSAGES);
    expect(agent.history.archive).toEqual(FOUR_MESSAGES);
    expect(agent.history.turns.filter(isCompactionTurn)[0]?.status).toBe("error");
  });

  test("snapshot and restore round-trip compacted state and turns", async () => {
    const { provider } = createCapturingProvider();
    const agent = new Agent({ provider, model: "mock" });
    agent.history.append(FOUR_MESSAGES);
    agent.onCompaction(() => [user("summary")]);
    await agent.compact();
    agent.history.append(user("five"));

    const session = await agent.snapshot();
    expect(session.messages).toEqual([user("summary"), user("five")]);
    expect(session.archive).toEqual([...FOUR_MESSAGES, user("five")]);
    expect(session.compactions).toHaveLength(1);

    const restored = new Agent({ provider, model: "mock" }, session);
    expect(restored.history.messages).toEqual(agent.history.messages);
    expect(restored.history.archive).toEqual(agent.history.archive);
    expect(restored.history.compactions).toEqual(agent.history.compactions);
    expect(restored.history.turns.filter(isCompactionTurn)).toHaveLength(1);
  });

  test("send builds the request from the active conversation", async () => {
    const { provider, requests } = createCapturingProvider();
    const agent = new Agent({ provider, model: "mock" });
    agent.history.append(FOUR_MESSAGES);
    const summary = [user("summary of the first four")];
    agent.onCompaction(() => summary);
    await agent.compact();

    const result = await agent.send("next question").final;
    expect(result.ok).toBe(true);

    expect(requests).toHaveLength(1);
    const sent = requests[0];
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(summary[0]);
    expect(sent[1].content).toEqual([{ type: "text", text: "next question" }]);

    expect(agent.history.messages).toHaveLength(3);
    expect(agent.history.archive).toHaveLength(6);
  });

  test("turns stay coherent across send, compact, send", async () => {
    const { provider } = createCapturingProvider();
    const agent = new Agent({ provider, model: "mock" });
    agent.onCompaction(() => [user("summary")]);

    await agent.send("first").final;
    await agent.compact();
    await agent.send("second").final;

    const kinds = agent.history.turns.map((entry) =>
      isCompactionTurn(entry) ? "compaction" : entry.owner,
    );
    expect(kinds).toEqual(["user", "agent", "compaction", "user", "agent"]);
    expect(agent.history.turns.filter(isCompactionTurn)[0]?.status).toBe("complete");
  });

  test("a consumer folding the event stream reproduces history.turns exactly", async () => {
    const { provider } = createCapturingProvider();
    const agent = new Agent({ provider, model: "mock" });
    agent.onCompaction(() => [user("summary")]);

    const consumer = new TurnAccumulator();
    agent.on((event) => consumer.apply(event));

    await agent.send("first").final;
    await agent.compact();
    await agent.send("second").final;

    expect(consumer.state.turns).toEqual(agent.history.turns);
    expect(consumer.state.sessionAnnotations ?? []).toEqual(agent.history.sessionAnnotations);
  });

  test("compact called during an in-flight send runs after the send settles", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const provider: AIProvider = {
      name: "gated",
      async createGenerationRequest() {
        throw new Error("not used");
      },
      async *createStreamingRequest(): AsyncGenerator<AnyStreamChunk, void> {
        yield { type: "start", id: "g1", data: { model: "mock", timestamp: 0 } };
        await gate;
        yield { type: "text-start", data: { index: 0 } };
        yield { type: "text-delta", data: { index: 0, text: "answer" } };
        yield { type: "text-complete", data: { index: 0 } };
        yield {
          type: "complete",
          data: { finishReason: AxleStopReason.Stop, usage: { in: 1, out: 1 } },
        };
      },
    };

    const agent = new Agent({ provider, model: "mock" });
    const seenByCallback: number[] = [];
    agent.onCompaction((state) => {
      seenByCallback.push(state.messages.length);
      return [user("summary")];
    });

    const sendResult = agent.send("question").final;
    const compactResult = agent.compact();
    release();
    await Promise.all([sendResult, compactResult]);

    // The callback ran after the send completed: it saw both the user
    // message and the assistant answer, not a mid-turn snapshot.
    expect(seenByCallback).toEqual([2]);
    const kinds = agent.history.turns.map((entry) =>
      isCompactionTurn(entry) ? "compaction" : entry.owner,
    );
    expect(kinds).toEqual(["user", "agent", "compaction"]);
  });

  test("compact aborted before it starts is a no-op: no callback, no events, no entry", async () => {
    const { provider } = createCapturingProvider();
    const agent = new Agent({ provider, model: "mock" });
    agent.history.append(FOUR_MESSAGES);
    const events: TurnEvent[] = [];
    agent.on((event) => events.push(event));

    const controller = new AbortController();
    controller.abort("stop");
    let called = false;
    agent.onCompaction(() => {
      called = true;
      return [user("summary")];
    });

    await expect(agent.compact({ signal: controller.signal })).resolves.toBeNull();
    expect(called).toBe(false);
    expect(events).toEqual([]);
    expect(agent.history.turns).toEqual([]);
    expect(agent.history.messages).toEqual(FOUR_MESSAGES);
  });

  test("aborting during the callback discards its result", async () => {
    const { provider } = createCapturingProvider();
    const agent = new Agent({ provider, model: "mock" });
    agent.history.append(FOUR_MESSAGES);

    const controller = new AbortController();
    agent.onCompaction(() => {
      controller.abort("changed my mind");
      return [user("summary")];
    });

    await expect(agent.compact({ signal: controller.signal })).resolves.toBeNull();
    expect(agent.history.messages).toEqual(FOUR_MESSAGES);
    expect(agent.history.compactions).toEqual([]);
    expect(agent.history.turns.filter(isCompactionTurn)).toEqual([]);
  });

  test("a callback that throws on a forwarded abort is a skip, not an error", async () => {
    const { provider } = createCapturingProvider();
    const agent = new Agent({ provider, model: "mock" });
    agent.history.append(FOUR_MESSAGES);

    const controller = new AbortController();
    const events: TurnEvent[] = [];
    agent.on((event) => events.push(event));
    agent.onCompaction((_state, { signal }) => {
      controller.abort("user cancelled");
      throw new AxleAbortError("Generate aborted", { reason: signal?.reason });
    });

    await expect(agent.compact({ signal: controller.signal })).resolves.toBeNull();
    expect(agent.history.messages).toEqual(FOUR_MESSAGES);
    expect(agent.history.compactions).toEqual([]);
    expect(agent.history.turns.filter(isCompactionTurn)).toEqual([]);
    const endEvent = events.find((e) => e.type === "compaction:end");
    expect(endEvent?.type === "compaction:end" && endEvent.outcome).toBe("skipped");
  });

  test("a callback returning undefined is treated as a skip, not an error", async () => {
    const { provider } = createCapturingProvider();
    const agent = new Agent({ provider, model: "mock" });
    agent.history.append(FOUR_MESSAGES);
    agent.onCompaction(() => undefined as any);

    await expect(agent.compact()).resolves.toBeNull();
    expect(agent.history.messages).toEqual(FOUR_MESSAGES);
    expect(agent.history.turns.filter(isCompactionTurn)).toEqual([]);
  });

  test("snapshot requested mid-send waits for quiescence and never captures a running turn", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const provider: AIProvider = {
      name: "gated",
      async createGenerationRequest() {
        throw new Error("not used");
      },
      async *createStreamingRequest(): AsyncGenerator<AnyStreamChunk, void> {
        yield { type: "start", id: "g1", data: { model: "mock", timestamp: 0 } };
        await gate;
        yield { type: "text-start", data: { index: 0 } };
        yield { type: "text-delta", data: { index: 0, text: "answer" } };
        yield { type: "text-complete", data: { index: 0 } };
        yield {
          type: "complete",
          data: { finishReason: AxleStopReason.Stop, usage: { in: 1, out: 1 } },
        };
      },
    };

    const agent = new Agent({ provider, model: "mock" });
    const sendResult = agent.send("question").final;
    const sessionPromise = agent.snapshot();
    release();
    const [, session] = await Promise.all([sendResult, sessionPromise]);

    const statuses = session.turns?.map((entry) => entry.status);
    expect(statuses).toEqual(["complete", "complete"]);
  });

  test("a restored agent keeps folding onto the restored turns", async () => {
    const { provider } = createCapturingProvider();
    const first = new Agent({ provider, model: "mock" });
    first.onCompaction(() => [user("summary")]);
    await first.send("first").final;
    await first.compact();

    const restored = new Agent({ provider, model: "mock" }, await first.snapshot());
    await restored.send("second").final;

    const kinds = restored.history.turns.map((entry) =>
      isCompactionTurn(entry) ? "compaction" : entry.owner,
    );
    expect(kinds).toEqual(["user", "agent", "compaction", "user", "agent"]);
  });

  test("compact produces an agent.compact span with outcome and token attributes", async () => {
    const { provider } = createCapturingProvider();
    const starts: SpanData[] = [];
    const ends: SpanData[] = [];
    const tracer = new Tracer();
    tracer.addWriter({
      onSpanStart: (span) => starts.push({ ...span }),
      onSpanEnd: (span) => ends.push({ ...span }),
    });
    const agent = new Agent({
      provider,
      model: "mock",
      sessionId: "session-1",
      observability: { trace: tracer },
    });
    agent.history.append(FOUR_MESSAGES);
    agent.onCompaction(() => [user("summary")]);

    await agent.compact();

    const span = ends.find((s) => s.name === "agent.compact");
    expect(span).toBeDefined();
    expect(span?.status).toBe("ok");
    expect(span?.attributes).toMatchObject({ sessionId: "session-1", outcome: "complete" });
    expect(span?.attributes?.beforeTokens).toBeGreaterThan(0);
    expect(span?.attributes?.afterTokens).toBeGreaterThan(0);
  });

  test("a failing compaction marks the agent.compact span as error", async () => {
    const { provider } = createCapturingProvider();
    const ends: SpanData[] = [];
    const tracer = new Tracer();
    tracer.addWriter({
      onSpanStart: () => {},
      onSpanEnd: (span) => ends.push({ ...span }),
    });
    const agent = new Agent({ provider, model: "mock", observability: { trace: tracer } });
    agent.history.append(FOUR_MESSAGES);
    agent.onCompaction(() => {
      throw new Error("summarizer down");
    });

    await expect(agent.compact()).rejects.toThrow("summarizer down");

    const span = ends.find((s) => s.name === "agent.compact");
    expect(span?.status).toBe("error");
    expect(span?.attributes).toMatchObject({ outcome: "error" });
  });
});
