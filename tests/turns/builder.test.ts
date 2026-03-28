import { describe, expect, test } from "vitest";
import { AxleStopReason } from "../../src/providers/types.js";
import { TurnBuilder } from "../../src/turns/builder.js";
import type { AgentEvent } from "../../src/turns/events.js";

describe("TurnBuilder", () => {
  test("createUserTurn produces user turn and turn:user event", () => {
    const builder = new TurnBuilder();
    const { turn, events } = builder.createUserTurn({
      role: "user",
      id: "u1",
      content: [{ type: "text", text: "Hello" }],
    });

    expect(turn.owner).toBe("user");
    expect(turn.parts).toHaveLength(1);
    expect(turn.parts[0].type).toBe("text");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("turn:user");
  });

  test("startAgentTurn produces agent turn and turn:start event", () => {
    const builder = new TurnBuilder();
    const { turn, events } = builder.startAgentTurn();

    expect(turn.owner).toBe("agent");
    expect(turn.parts).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("turn:start");
  });

  test("text streaming produces correct events and builds turn", () => {
    const builder = new TurnBuilder();
    builder.startAgentTurn();

    const allEvents: AgentEvent[] = [];

    const e1 = builder.handleStreamEvent({
      type: "text:start",
      index: 0,
    });
    allEvents.push(...e1);

    const e2 = builder.handleStreamEvent({
      type: "text:delta",
      index: 0,
      delta: "Hello",
      accumulated: "Hello",
    });
    allEvents.push(...e2);

    const e3 = builder.handleStreamEvent({
      type: "text:delta",
      index: 0,
      delta: " world",
      accumulated: "Hello world",
    });
    allEvents.push(...e3);

    const e4 = builder.handleStreamEvent({
      type: "text:end",
      index: 0,
      final: "Hello world",
    });
    allEvents.push(...e4);

    const eventTypes = allEvents.map((e) => e.type);
    expect(eventTypes).toContain("part:start");
    expect(eventTypes).toContain("text:delta");
    expect(eventTypes).toContain("part:end");
  });

  test("thinking streaming produces correct events", () => {
    const builder = new TurnBuilder();
    builder.startAgentTurn();

    const events: AgentEvent[] = [];
    events.push(...builder.handleStreamEvent({ type: "thinking:start", index: 0 }));
    events.push(
      ...builder.handleStreamEvent({
        type: "thinking:delta",
        index: 0,
        delta: "Thinking...",
        accumulated: "Thinking...",
      }),
    );
    events.push(
      ...builder.handleStreamEvent({ type: "thinking:end", index: 0, final: "Thinking..." }),
    );

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("part:start");
    expect(eventTypes).toContain("thinking:delta");
    expect(eventTypes).toContain("part:end");

    const partStart = events.find((e) => e.type === "part:start");
    if (partStart?.type === "part:start") {
      expect(partStart.part.type).toBe("thinking");
    }
  });

  test("tool call lifecycle produces correct events", () => {
    const builder = new TurnBuilder();
    const { turn } = builder.startAgentTurn();

    const events: AgentEvent[] = [];
    events.push(
      ...builder.handleStreamEvent({
        type: "tool:request",
        index: 0,
        id: "tc1",
        name: "calculator",
      }),
    );
    events.push(
      ...builder.handleStreamEvent({
        type: "tool:exec-start",
        index: 0,
        id: "tc1",
        name: "calculator",
        parameters: { expression: "2+2" },
      }),
    );
    events.push(
      ...builder.handleStreamEvent({
        type: "tool:exec-complete",
        index: 0,
        id: "tc1",
        name: "calculator",
        result: { type: "success", content: "4" },
      }),
    );

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("part:start");
    expect(eventTypes).toContain("action:running");
    expect(eventTypes).toContain("action:complete");

    expect(turn.parts).toHaveLength(1);
    const part = turn.parts[0];
    expect(part.type).toBe("action");
    if (part.type === "action" && part.kind === "tool") {
      expect(part.status).toBe("complete");
      expect(part.detail.providerId).toBe("tc1");
      expect(part.detail.result).toEqual({ type: "success", content: "4" });
    }
  });

  test("tool call error produces action:error event", () => {
    const builder = new TurnBuilder();
    builder.startAgentTurn();

    const events: AgentEvent[] = [];
    events.push(
      ...builder.handleStreamEvent({
        type: "tool:request",
        index: 0,
        id: "tc1",
        name: "calculator",
      }),
    );
    events.push(
      ...builder.handleStreamEvent({
        type: "tool:exec-complete",
        index: 0,
        id: "tc1",
        name: "calculator",
        result: { type: "error", error: { type: "runtime", message: "fail" } },
      }),
    );

    const errorEvents = events.filter((e) => e.type === "action:error");
    expect(errorEvents).toHaveLength(1);
  });

  test("internal tool lifecycle produces correct events", () => {
    const builder = new TurnBuilder();
    builder.startAgentTurn();

    const events: AgentEvent[] = [];
    events.push(
      ...builder.handleStreamEvent({
        type: "internal-tool:start",
        index: 0,
        id: "it1",
        name: "web_search",
      }),
    );
    events.push(
      ...builder.handleStreamEvent({
        type: "internal-tool:complete",
        index: 0,
        id: "it1",
        name: "web_search",
        output: "search results",
      }),
    );

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("part:start");
    expect(eventTypes).toContain("action:running");
    expect(eventTypes).toContain("action:complete");
  });

  test("turn:complete accumulates usage, finalizeTurn emits it", () => {
    const builder = new TurnBuilder();
    const { turn } = builder.startAgentTurn();

    builder.handleStreamEvent({
      type: "turn:complete",
      message: {
        role: "assistant",
        id: "a1",
        model: "test-model",
        content: [{ type: "text", text: "Hi" }],
        finishReason: AxleStopReason.FunctionCall,
      },
      usage: { in: 10, out: 20 },
    });

    builder.handleStreamEvent({
      type: "turn:complete",
      message: {
        role: "assistant",
        id: "a2",
        model: "test-model",
        content: [{ type: "text", text: "Done" }],
        finishReason: AxleStopReason.Stop,
      },
      usage: { in: 15, out: 25 },
    });

    const events = builder.finalizeTurn();
    const endEvent = events.find((e) => e.type === "turn:end");
    expect(endEvent).toBeDefined();
    if (endEvent?.type === "turn:end") {
      expect(endEvent.usage).toEqual({ in: 25, out: 45 });
    }
    expect(turn.usage).toEqual({ in: 25, out: 45 });
  });

  test("finalizeTurn produces turn:end event", () => {
    const builder = new TurnBuilder();
    builder.startAgentTurn();

    const events = builder.finalizeTurn();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("turn:end");
  });

  test("finalizeTurn with no active turn returns empty", () => {
    const builder = new TurnBuilder();
    expect(builder.finalizeTurn()).toEqual([]);
  });

  test("handleStreamEvent with no active turn returns empty", () => {
    const builder = new TurnBuilder();
    const events = builder.handleStreamEvent({
      type: "text:start",
      index: 0,
    });
    expect(events).toEqual([]);
  });

  test("step metadata is populated from turn:complete and tool-results:complete", () => {
    const builder = new TurnBuilder();
    const { turn } = builder.startAgentTurn();

    builder.handleStreamEvent({ type: "text:start", index: 0 });
    builder.handleStreamEvent({ type: "text:end", index: 0, final: "Checking..." });
    builder.handleStreamEvent({ type: "tool:request", index: 1, id: "call_1", name: "search" });

    builder.handleStreamEvent({
      type: "turn:complete",
      message: {
        role: "assistant",
        id: "msg_asst_1",
        content: [
          { type: "text", text: "Checking..." },
          { type: "tool-call", id: "call_1", name: "search", parameters: {} },
        ],
        finishReason: AxleStopReason.FunctionCall,
      },
      usage: { in: 10, out: 5 },
    });

    builder.handleStreamEvent({
      type: "tool-results:complete",
      message: { role: "tool", id: "msg_tools_1", content: [] },
    });

    builder.handleStreamEvent({ type: "text:start", index: 2 });
    builder.handleStreamEvent({ type: "text:end", index: 2, final: "Done" });

    builder.handleStreamEvent({
      type: "turn:complete",
      message: {
        role: "assistant",
        id: "msg_asst_2",
        content: [{ type: "text", text: "Done" }],
        finishReason: AxleStopReason.Stop,
      },
      usage: { in: 5, out: 3 },
    });

    builder.finalizeTurn();

    expect(turn.steps).toHaveLength(2);
    expect(turn.steps![0]).toEqual({
      assistantMessageId: "msg_asst_1",
      toolResultsMessageId: "msg_tools_1",
    });
    expect(turn.steps![1]).toEqual({
      assistantMessageId: "msg_asst_2",
    });
  });

  test("finalizeTurn flushes last step without tool results", () => {
    const builder = new TurnBuilder();
    const { turn } = builder.startAgentTurn();

    builder.handleStreamEvent({ type: "text:start", index: 0 });
    builder.handleStreamEvent({ type: "text:end", index: 0, final: "Hello" });
    builder.handleStreamEvent({
      type: "turn:complete",
      message: {
        role: "assistant",
        id: "msg_final",
        content: [{ type: "text", text: "Hello" }],
        finishReason: AxleStopReason.Stop,
      },
      usage: { in: 1, out: 1 },
    });

    builder.finalizeTurn();

    expect(turn.steps).toHaveLength(1);
    expect(turn.steps![0]).toEqual({ assistantMessageId: "msg_final" });
    expect(turn.steps![0].toolResultsMessageId).toBeUndefined();
  });
});
