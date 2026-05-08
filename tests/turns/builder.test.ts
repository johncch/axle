import { afterEach, describe, expect, test, vi } from "vitest";
import { AxleStopReason } from "../../src/providers/types.js";
import { TurnBuilder } from "../../src/turns/builder.js";
import type { AgentEvent } from "../../src/turns/events.js";

describe("TurnBuilder", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("createUserTurn produces user turn and turn:user event", () => {
    const builder = new TurnBuilder();
    const { turn, events } = builder.createUserTurn({
      role: "user",
      id: "u1",
      content: [{ type: "text", text: "Hello" }],
    });

    expect(turn.owner).toBe("user");
    expect(turn.status).toBe("complete");
    expect(turn.parts).toHaveLength(1);
    expect(turn.parts[0].type).toBe("text");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("turn:user");
  });

  test("createUserTurn records completed timing for turn and parts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));

    const builder = new TurnBuilder();
    const { turn } = builder.createUserTurn({
      role: "user",
      id: "u1",
      content: [{ type: "text", text: "Hello" }],
    });

    expect(turn.timing).toEqual({
      start: "2026-04-23T12:00:00.000Z",
      end: "2026-04-23T12:00:00.000Z",
    });
    expect(turn.parts[0].timing).toEqual(turn.timing);
  });

  test("startAgentTurn produces agent turn and turn:start event", () => {
    const builder = new TurnBuilder();
    const { turn, events } = builder.startAgentTurn();

    expect(turn.owner).toBe("agent");
    expect(turn.status).toBe("streaming");
    expect(turn.parts).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("turn:start");
  });

  test("finalizeTurn records agent turn duration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));

    const builder = new TurnBuilder();
    const { turn } = builder.startAgentTurn();

    expect(turn.timing).toEqual({ start: "2026-04-23T12:00:00.000Z" });

    vi.advanceTimersByTime(123);
    const events = builder.finalizeTurn();

    expect(turn.timing).toEqual({
      start: "2026-04-23T12:00:00.000Z",
      end: "2026-04-23T12:00:00.123Z",
    });
    expect(events[0]).toMatchObject({ type: "turn:end", timing: turn.timing });
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

  test("text streaming records part timing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));

    const builder = new TurnBuilder();
    const { turn } = builder.startAgentTurn();

    builder.handleStreamEvent({ type: "text:start", index: 0 });
    vi.advanceTimersByTime(75);
    const events = builder.handleStreamEvent({
      type: "text:end",
      index: 0,
      final: "Hello",
    });

    expect(turn.parts[0].timing).toEqual({
      start: "2026-04-23T12:00:00.000Z",
      end: "2026-04-23T12:00:00.075Z",
    });
    expect(events[0]).toMatchObject({ type: "part:end", timing: turn.parts[0].timing });
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
      expect(part.detail.result).toEqual({ type: "success", content: "4" });
    }
  });

  test("tool call lifecycle records action part timing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));

    const builder = new TurnBuilder();
    const { turn } = builder.startAgentTurn();

    builder.handleStreamEvent({
      type: "tool:request",
      index: 0,
      id: "tc1",
      name: "calculator",
    });
    vi.advanceTimersByTime(40);
    builder.handleStreamEvent({
      type: "tool:exec-complete",
      index: 0,
      id: "tc1",
      name: "calculator",
      result: { type: "success", content: "4" },
    });

    expect(turn.parts[0].timing).toEqual({
      start: "2026-04-23T12:00:00.000Z",
      end: "2026-04-23T12:00:00.040Z",
    });
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

  test("tool not found produces action:error instead of action:complete", () => {
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
        type: "tool:exec-complete",
        index: 0,
        id: "tc1",
        name: "calculator",
        result: { type: "error", error: { type: "not-found", message: "Tool not found" } },
      }),
    );

    expect(events.filter((e) => e.type === "action:complete")).toHaveLength(0);
    expect(events.filter((e) => e.type === "action:error")).toHaveLength(1);

    const part = turn.parts[0];
    expect(part.type).toBe("action");
    if (part.type === "action" && part.kind === "tool") {
      expect(part.status).toBe("error");
      expect(part.detail.result).toEqual({
        type: "error",
        error: { type: "not-found", message: "Tool not found" },
      });
    }
  });

  test("tool:args-delta accumulates pendingArgs and emits action:args-delta", () => {
    const builder = new TurnBuilder();
    const { turn } = builder.startAgentTurn();

    builder.handleStreamEvent({ type: "tool:request", index: 0, id: "tc1", name: "do" });
    const evs1 = builder.handleStreamEvent({
      type: "tool:args-delta",
      index: 0,
      id: "tc1",
      name: "do",
      delta: '{"x":',
      accumulated: '{"x":',
    });
    const evs2 = builder.handleStreamEvent({
      type: "tool:args-delta",
      index: 0,
      id: "tc1",
      name: "do",
      delta: '"hi"}',
      accumulated: '{"x":"hi"}',
    });

    const argDeltas = [...evs1, ...evs2].filter((e) => e.type === "action:args-delta");
    expect(argDeltas).toHaveLength(2);
    if (argDeltas[1].type === "action:args-delta") {
      expect(argDeltas[1].accumulated).toBe('{"x":"hi"}');
    }

    const part = turn.parts.find((p: any) => p.kind === "tool") as any;
    expect(part.detail.pendingArgs).toBe('{"x":"hi"}');

    // tool:exec-start clears pendingArgs and sets parameters
    builder.handleStreamEvent({
      type: "tool:exec-start",
      index: 0,
      id: "tc1",
      name: "do",
      parameters: { x: "hi" },
    });
    expect(part.detail.pendingArgs).toBeUndefined();
    expect(part.detail.parameters).toEqual({ x: "hi" });
  });

  test("internal tool lifecycle produces correct events", () => {
    const builder = new TurnBuilder();
    builder.startAgentTurn();

    const events: AgentEvent[] = [];
    events.push(
      ...builder.handleStreamEvent({
        type: "provider-tool:start",
        index: 0,
        id: "it1",
        name: "web_search",
      }),
    );
    events.push(
      ...builder.handleStreamEvent({
        type: "provider-tool:complete",
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
      expect(endEvent.status).toBe("complete");
    }
    expect(turn.usage).toEqual({ in: 25, out: 45 });
    expect(turn.status).toBe("complete");
  });

  test.each([
    [undefined, "complete"],
    ["cancelled" as const, "cancelled"],
    ["error" as const, "error"],
  ])("finalizeTurn(%s) sets %s status", (outcome, status) => {
    const builder = new TurnBuilder();
    const { turn } = builder.startAgentTurn();

    const events = builder.finalizeTurn(outcome);

    expect(turn.status).toBe(status);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "turn:end",
      turnId: turn.id,
      status,
    });
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
});
