import { describe, expect, test } from "vitest";
import { Agent } from "../../src/core/agent/index.js";
import { AxleAbortError } from "../../src/errors/AxleAbortError.js";
import { AxleAgentAbortError } from "../../src/errors/AxleAgentAbortError.js";
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
import type { CompactionPart, Turn } from "../../src/turns/types.js";

function isCompactionTurn(turn: Turn): boolean {
  return turn.parts.some((part) => part.type === "compaction");
}

function compactionPartOf(turn: Turn | undefined): CompactionPart | undefined {
  return turn?.parts.find((part) => part.type === "compaction") as CompactionPart | undefined;
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

const FOUR_MESSAGES: AxleMessage[] = [
  user("one"),
  assistant("a1", "two"),
  user("three"),
  assistant("a2", "four"),
];

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

function seededAgent(provider: AIProvider, messages: AxleMessage[]): Agent {
  return new Agent({ provider, model: "mock" }, { sessionId: "seeded", messages });
}

function attachTape(agent: Agent): TurnAccumulator {
  const tape = new TurnAccumulator();
  agent.on((event) => tape.apply(event));
  return tape;
}

describe("Agent.compact", () => {
  test("manual compaction runs the full part lifecycle in its own turn", async () => {
    const { provider } = createCapturingProvider();
    const agent = seededAgent(provider, FOUR_MESSAGES);
    const tape = attachTape(agent);
    const events: TurnEvent[] = [];
    agent.on((event) => events.push(event));

    const summary = [user("summary of the first four")];
    agent.setCompaction({
      compact: (state, context) => {
        expect(state.messages).toHaveLength(4);
        expect(context.usage.total).toBeGreaterThan(0);
        expect(context.trigger).toBe("manual");
        expect(typeof context.id).toBe("string");
        return { messages: summary };
      },
    });

    const result = await agent.compact();

    expect(result).toBe(true);
    expect(agent.messages).toEqual(summary);
    expect(events.map((e) => e.type)).toEqual([
      "turn:start",
      "part:start",
      "compaction:complete",
      "turn:end",
    ]);

    const entries = tape.state.turns.filter(isCompactionTurn);
    expect(entries).toHaveLength(1);
    expect(entries[0].owner).toBe("agent");
    expect(entries[0].status).toBe("complete");
    const part = compactionPartOf(entries[0]);
    expect(part).toMatchObject({ id: entries[0].id, type: "compaction", status: "complete" });
    expect(part?.summary).toBeUndefined();
  });

  test("ctx.emit streams deltas onto the running part; the returned summary settles it", async () => {
    const { provider } = createCapturingProvider();
    const agent = seededAgent(provider, FOUR_MESSAGES);
    const tape = attachTape(agent);
    const events: TurnEvent[] = [];
    agent.on((event) => events.push(event));

    agent.setCompaction({
      compact: (_state, context) => {
        context.emit("here is ");
        context.emit("what I remember");
        return {
          messages: [user("internal continuation summary for the model")],
          summary: "Reduced the context by 50%",
        };
      },
    });

    await agent.compact();

    expect(events.filter((e) => e.type === "compaction:delta")).toHaveLength(2);
    const part = compactionPartOf(tape.state.turns.find(isCompactionTurn));
    expect(part?.status).toBe("complete");
    expect(part?.summary).toBe("Reduced the context by 50%");
  });

  test("a shouldCompact decline is the silent path: false, nothing emitted, nothing ran", async () => {
    const { provider } = createCapturingProvider();
    const agent = seededAgent(provider, FOUR_MESSAGES);
    const tape = attachTape(agent);
    let compactRan = false;
    agent.setCompaction({
      shouldCompact: () => false,
      compact: () => {
        compactRan = true;
        return { messages: [user("never")] };
      },
    });

    const events: TurnEvent[] = [];
    agent.on((event) => events.push(event));

    const result = await agent.compact();

    expect(result).toBe(false);
    expect(compactRan).toBe(false);
    expect(agent.messages).toEqual(FOUR_MESSAGES);
    expect(events).toEqual([]);
    expect(tape.state.turns).toEqual([]);
  });

  test("is a no-op without a registered config", async () => {
    const { provider } = createCapturingProvider();
    const agent = seededAgent(provider, FOUR_MESSAGES);
    const events: TurnEvent[] = [];
    agent.on((event) => events.push(event));

    await expect(agent.compact()).resolves.toBe(false);
    expect(events).toEqual([]);
    expect(agent.messages).toEqual(FOUR_MESSAGES);
  });

  test("an invalid result rejects the manual compact and settles an errored part on the tape", async () => {
    const { provider } = createCapturingProvider();
    const agent = seededAgent(provider, FOUR_MESSAGES);
    const tape = attachTape(agent);
    agent.setCompaction({ compact: () => ({ messages: [assistantToolCall("a1", "tc1")] }) });

    await expect(agent.compact()).rejects.toThrowError(/unanswered tool calls/);
    expect(agent.messages).toEqual(FOUR_MESSAGES);

    const entry = tape.state.turns.find(isCompactionTurn);
    expect(entry?.status).toBe("error");
    const part = compactionPartOf(entry);
    expect(part?.status).toBe("error");
    expect(part?.error).toMatch(/unanswered tool calls/);
  });

  test("a callback returning no messages is an errored compaction, not a skip", async () => {
    const { provider } = createCapturingProvider();
    const agent = seededAgent(provider, FOUR_MESSAGES);
    const tape = attachTape(agent);
    agent.setCompaction({ compact: () => undefined as any });

    await expect(agent.compact()).rejects.toThrowError(/must return \{ messages \}/);
    expect(agent.messages).toEqual(FOUR_MESSAGES);
    expect(compactionPartOf(tape.state.turns.find(isCompactionTurn))?.status).toBe("error");
  });

  test("snapshot and restore round-trip the compacted conversation", async () => {
    const { provider } = createCapturingProvider();
    const agent = seededAgent(provider, FOUR_MESSAGES);
    agent.setCompaction({ compact: () => ({ messages: [user("summary")] }) });
    await agent.compact();

    const session = await agent.snapshot();
    expect(session).toEqual({ sessionId: "seeded", messages: [user("summary")] });

    const restored = new Agent({ provider, model: "mock" }, session);
    expect(restored.messages).toEqual([user("summary")]);
    expect(restored.sessionId).toBe("seeded");
  });

  test("send builds the request from the active conversation", async () => {
    const { provider, requests } = createCapturingProvider();
    const agent = seededAgent(provider, FOUR_MESSAGES);
    const summary = [user("summary of the first four")];
    agent.setCompaction({ compact: () => ({ messages: summary }) });
    await agent.compact();

    const result = await agent.send("next question").final;
    expect(result.ok).toBe(true);

    expect(requests).toHaveLength(1);
    const sent = requests[0];
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(summary[0]);
    expect(sent[1].content).toEqual([{ type: "text", text: "next question" }]);

    expect(agent.messages).toHaveLength(3);
  });

  test("beforeTurn embeds the compaction at the head of the send's turn", async () => {
    const { provider, requests } = createCapturingProvider();
    const agent = seededAgent(provider, FOUR_MESSAGES);
    const tape = attachTape(agent);
    const summary = [user("summary before the next turn")];
    agent.setCompaction({
      compact: () => ({ messages: summary }),
      triggers: { beforeTurn: true },
    });

    await agent.send("next question").final;

    expect(requests).toHaveLength(1);
    expect(requests[0]).toHaveLength(2);
    expect(requests[0][0]).toEqual(summary[0]);
    expect(requests[0][1]).toMatchObject({ role: "user" });
    expect(tape.state.turns.map((turn) => turn.owner)).toEqual(["user", "agent"]);
    const agentTurn = tape.state.turns[1];
    expect(agentTurn.parts.map((part) => part.type)).toEqual(["compaction", "text"]);
    expect(agentTurn.status).toBe("complete");
    expect(compactionPartOf(agentTurn)?.status).toBe("complete");
  });

  test("a beforeTurn compaction failure is non-fatal: the part records it, the send continues uncompacted", async () => {
    const { provider, requests } = createCapturingProvider();
    const agent = seededAgent(provider, FOUR_MESSAGES);
    const tape = attachTape(agent);
    agent.setCompaction({
      compact: () => {
        throw new Error("summarizer down");
      },
      triggers: { beforeTurn: true },
    });

    const result = await agent.send("next question").final;

    expect(result.ok).toBe(true);
    expect(result.response).toBe("ok");
    // The request went out on the uncompacted conversation.
    expect(requests[0]).toHaveLength(5);
    const agentTurn = tape.state.turns[1];
    expect(agentTurn.status).toBe("complete");
    expect(agentTurn.parts.map((part) => part.type)).toEqual(["compaction", "text"]);
    const part = compactionPartOf(agentTurn);
    expect(part?.status).toBe("error");
    expect(part?.error).toBe("summarizer down");
    // Conversation committed uncompacted: four seeded + user + assistant.
    expect(agent.messages).toHaveLength(6);
  });

  test("cancelling during beforeTurn compaction retains the committed user message", async () => {
    const { provider, requests } = createCapturingProvider();
    const agent = seededAgent(provider, FOUR_MESSAGES);
    const tape = attachTape(agent);
    const controller = new AbortController();
    agent.setCompaction({
      compact: () => {
        controller.abort("cancel during compaction");
        return { messages: [] };
      },
      triggers: { beforeTurn: true },
    });

    await expect(
      agent.send("keep this message", { signal: controller.signal }).final,
    ).rejects.toMatchObject({
      name: "AbortError",
      reason: "cancel during compaction",
    });

    expect(requests).toEqual([]);
    expect(agent.messages).toHaveLength(5);
    expect(agent.messages.at(-1)).toMatchObject({ role: "user" });
    expect(JSON.stringify(agent.messages.at(-1)?.content)).toContain("keep this message");
    expect(tape.state.turns.map((turn) => turn.status)).toEqual(["complete", "cancelled"]);
    expect(compactionPartOf(tape.state.turns[1])?.status).toBe("error");
  });

  test("afterTurn embeds the compaction at the tail of the send's turn", async () => {
    const { provider } = createCapturingProvider();
    const agent = new Agent({ provider, model: "mock" });
    const tape = attachTape(agent);
    const summary = [user("summary after the turn")];
    agent.setCompaction({
      compact: () => ({ messages: summary }),
      triggers: { afterTurn: true },
    });

    const result = await agent.send("question").final;

    expect(result.ok).toBe(true);
    expect(agent.messages).toEqual(summary);
    expect(tape.state.turns.map((turn) => turn.owner)).toEqual(["user", "agent"]);
    const agentTurn = tape.state.turns[1];
    expect(agentTurn.parts.map((part) => part.type)).toEqual(["text", "compaction"]);
    expect(agentTurn.status).toBe("complete");
    expect(result.turn).toEqual(agentTurn);
  });

  test("an afterTurn compaction failure is non-fatal: the send resolves and the part records it", async () => {
    const { provider } = createCapturingProvider();
    const agent = new Agent({ provider, model: "mock" });
    const tape = attachTape(agent);
    agent.setCompaction({
      compact: () => {
        throw new Error("summarizer down");
      },
      triggers: { afterTurn: true },
    });

    const result = await agent.send("question").final;

    expect(result.ok).toBe(true);
    expect(result.response).toBe("ok");
    const agentTurn = tape.state.turns[1];
    expect(agentTurn.status).toBe("complete");
    expect(agentTurn.parts.map((part) => part.type)).toEqual(["text", "compaction"]);
    expect(compactionPartOf(agentTurn)?.status).toBe("error");
    expect(agent.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  test("a consumer tape stays coherent across send, compact, send", async () => {
    const { provider } = createCapturingProvider();
    const agent = new Agent({ provider, model: "mock" });
    const tape = attachTape(agent);
    agent.setCompaction({ compact: () => ({ messages: [user("summary")] }) });

    await agent.send("first").final;
    await agent.compact();
    const result = await agent.send("second").final;

    const kinds = tape.state.turns.map((entry) =>
      isCompactionTurn(entry) ? "compaction" : entry.owner,
    );
    expect(kinds).toEqual(["user", "agent", "compaction", "user", "agent"]);
    expect(tape.state.turns.filter(isCompactionTurn)[0]?.status).toBe("complete");
    expect(result.turn).toEqual(tape.state.turns.at(-1));
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
    const tape = attachTape(agent);
    const seenByCallback: number[] = [];
    agent.setCompaction({
      compact: (state) => {
        seenByCallback.push(state.messages.length);
        return { messages: [user("summary")] };
      },
    });

    const sendResult = agent.send("question").final;
    const compactResult = agent.compact();
    release();
    await Promise.all([sendResult, compactResult]);

    // The callback ran after the send completed: it saw both the user
    // message and the assistant answer, not a mid-turn snapshot.
    expect(seenByCallback).toEqual([2]);
    const kinds = tape.state.turns.map((entry) =>
      isCompactionTurn(entry) ? "compaction" : entry.owner,
    );
    expect(kinds).toEqual(["user", "agent", "compaction"]);
  });

  test("each compaction receives a fresh engine-generated id", async () => {
    const { provider } = createCapturingProvider();
    const agent = seededAgent(provider, FOUR_MESSAGES);
    const tape = attachTape(agent);

    const seen: string[] = [];
    agent.setCompaction({
      compact: (_state, { id }) => {
        seen.push(id);
        return { messages: [user("summary"), user("kept")] };
      },
    });

    await agent.compact();
    await agent.compact();

    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    const partIds = tape.state.turns.filter(isCompactionTurn).map((turn) => turn.parts[0]?.id);
    expect(partIds).toEqual(seen);
  });

  test("compact aborted before it starts rejects without running anything", async () => {
    const { provider } = createCapturingProvider();
    const agent = seededAgent(provider, FOUR_MESSAGES);
    const events: TurnEvent[] = [];
    agent.on((event) => events.push(event));

    const controller = new AbortController();
    controller.abort("stop");
    let called = false;
    agent.setCompaction({
      compact: () => {
        called = true;
        return { messages: [user("summary")] };
      },
    });

    const compaction = agent.compact({ signal: controller.signal });
    await expect(compaction).rejects.toBeInstanceOf(AxleAgentAbortError);
    await expect(compaction).rejects.toMatchObject({ name: "AbortError", reason: "stop" });
    expect(called).toBe(false);
    expect(events).toEqual([]);
    expect(agent.messages).toEqual(FOUR_MESSAGES);
  });

  test("aborting during the callback discards its result, rejects, and cancels the turn", async () => {
    const { provider } = createCapturingProvider();
    const agent = seededAgent(provider, FOUR_MESSAGES);
    const tape = attachTape(agent);

    const controller = new AbortController();
    agent.setCompaction({
      compact: () => {
        controller.abort("changed my mind");
        return { messages: [user("summary")] };
      },
    });

    await expect(agent.compact({ signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
      reason: "changed my mind",
    });
    expect(agent.messages).toEqual(FOUR_MESSAGES);
    const entry = tape.state.turns.find(isCompactionTurn);
    expect(entry?.status).toBe("cancelled");
    expect(compactionPartOf(entry)?.status).toBe("error");
  });

  test("a callback that throws on a forwarded abort rejects and cancels the turn", async () => {
    const { provider } = createCapturingProvider();
    const agent = seededAgent(provider, FOUR_MESSAGES);
    const tape = attachTape(agent);

    const controller = new AbortController();
    agent.setCompaction({
      compact: (_state, { signal }) => {
        controller.abort("user cancelled");
        throw new AxleAbortError("Generate aborted", { reason: signal?.reason });
      },
    });

    await expect(agent.compact({ signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
      reason: "user cancelled",
    });
    expect(agent.messages).toEqual(FOUR_MESSAGES);
    const entry = tape.state.turns.find(isCompactionTurn);
    expect(entry?.status).toBe("cancelled");
    expect(compactionPartOf(entry)?.status).toBe("error");
  });

  test("cancelling a compact queued behind a send rejects and leaves the send unaffected", async () => {
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
    const events: TurnEvent[] = [];
    agent.on((event) => events.push(event));
    let called = false;
    agent.setCompaction({
      compact: () => {
        called = true;
        return { messages: [user("summary")] };
      },
    });

    const send = agent.send("question").final;
    const compaction = agent.compact({ signal: AbortSignal.abort("changed my mind") });
    release();

    await expect(compaction).rejects.toMatchObject({
      message: "Agent compact aborted",
      name: "AbortError",
      reason: "changed my mind",
    });
    await expect(send).resolves.toMatchObject({ ok: true, response: "answer" });
    expect(called).toBe(false);
    const partStarts = events.filter((e) => e.type === "part:start");
    expect(partStarts.some((e) => e.type === "part:start" && e.part.type === "compaction")).toBe(
      false,
    );
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

    expect(session.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  test("a restored agent keeps folding onto a host-restored tape", async () => {
    const { provider } = createCapturingProvider();
    const first = new Agent({ provider, model: "mock" });
    const firstTape = attachTape(first);
    first.setCompaction({ compact: () => ({ messages: [user("summary")] }) });
    await first.send("first").final;
    await first.compact();

    const restored = new Agent({ provider, model: "mock" }, await first.snapshot());
    const restoredTape = new TurnAccumulator(firstTape.state);
    restored.on((event) => restoredTape.apply(event));
    await restored.send("second").final;

    const kinds = restoredTape.state.turns.map((entry) =>
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
    const agent = new Agent(
      {
        provider,
        model: "mock",
        observability: { trace: tracer },
      },
      { sessionId: "session-1", messages: FOUR_MESSAGES },
    );
    agent.setCompaction({ compact: () => ({ messages: [user("summary")] }) });

    await agent.compact();

    const span = ends.find((s) => s.name === "agent.compact");
    expect(span).toBeDefined();
    expect(span?.status).toBe("ok");
    expect(span?.attributes).toMatchObject({
      sessionId: "session-1",
      trigger: "manual",
      outcome: "complete",
    });
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
    const agent = new Agent(
      { provider, model: "mock", observability: { trace: tracer } },
      { sessionId: "seeded", messages: FOUR_MESSAGES },
    );
    agent.setCompaction({
      compact: () => {
        throw new Error("summarizer down");
      },
    });

    await expect(agent.compact()).rejects.toThrow("summarizer down");

    const span = ends.find((s) => s.name === "agent.compact");
    expect(span?.status).toBe("error");
    expect(span?.attributes).toMatchObject({ outcome: "error" });
  });
});
