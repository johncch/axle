import { afterEach, describe, expect, test, vi } from "vitest";
import { AxleStopReason } from "../../src/providers/types.js";
import { TurnEventBuilder } from "../../src/turns/eventBuilder.js";
import type { TurnEvent } from "../../src/turns/events.js";

describe("TurnEventBuilder", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("createUserTurn emits a completed user turn", () => {
    const builder = new TurnEventBuilder();
    const events = builder.createUserTurn({
      role: "user",
      id: "u1",
      content: [{ type: "text", text: "Hello" }],
      metadata: { source: "prompt-editor" },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "turn:user",
      turn: {
        id: "u1",
        owner: "user",
        status: "complete",
        metadata: { source: "prompt-editor" },
        parts: [{ type: "text", text: "Hello" }],
      },
    });
  });

  test("startAgentTurn emits turn:start with timing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));

    const builder = new TurnEventBuilder();
    const event = builder.startAgentTurn();

    expect(event).toMatchObject({
      type: "turn:start",
      timing: { start: "2026-04-23T12:00:00.000Z" },
    });
  });

  test("text streaming emits part and delta events", () => {
    const builder = new TurnEventBuilder();
    const start = builder.startAgentTurn();

    const events: TurnEvent[] = [];
    events.push(...builder.handleStreamEvent({ type: "text:start", index: 0 }));
    events.push(
      ...builder.handleStreamEvent({
        type: "text:delta",
        index: 0,
        delta: "Hello",
        accumulated: "Hello",
      }),
    );
    events.push(...builder.handleStreamEvent({ type: "text:end", index: 0, final: "Hello" }));

    expect(events.map((event) => event.type)).toEqual(["part:start", "text:delta", "part:end"]);
    expect(events[0]).toMatchObject({
      type: "part:start",
      turnId: start.turnId,
      part: { type: "text", text: "" },
    });
    expect(events[1]).toMatchObject({
      type: "text:delta",
      turnId: start.turnId,
      delta: "Hello",
    });
  });

  test("tool lifecycle emits action events with completion timing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));

    const builder = new TurnEventBuilder();
    const start = builder.startAgentTurn();

    const events: TurnEvent[] = [];
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
        type: "tool:args-delta",
        index: 0,
        id: "tc1",
        name: "calculator",
        delta: '{"expression":',
        accumulated: '{"expression":',
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
    vi.advanceTimersByTime(40);
    events.push(
      ...builder.handleStreamEvent({
        type: "tool:exec-complete",
        index: 0,
        id: "tc1",
        name: "calculator",
        result: { type: "success", content: "4" },
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      "part:start",
      "action:args-delta",
      "action:running",
      "action:complete",
    ]);
    expect(events[3]).toMatchObject({
      type: "action:complete",
      turnId: start.turnId,
      result: { type: "success", content: "4" },
      timing: {
        start: "2026-04-23T12:00:00.000Z",
        end: "2026-04-23T12:00:00.040Z",
      },
    });
  });

  test("tool errors emit action:error", () => {
    const builder = new TurnEventBuilder();
    builder.startAgentTurn();
    builder.handleStreamEvent({ type: "tool:request", index: 0, id: "tc1", name: "calculator" });

    const events = builder.handleStreamEvent({
      type: "tool:exec-complete",
      index: 0,
      id: "tc1",
      name: "calculator",
      result: { type: "error", error: { type: "runtime", message: "fail" } },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "action:error",
      error: { type: "runtime", message: "fail" },
    });
  });

  test("provider tool lifecycle emits action events", () => {
    const builder = new TurnEventBuilder();
    builder.startAgentTurn();

    const events: TurnEvent[] = [];
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

    expect(events.map((event) => event.type)).toEqual([
      "part:start",
      "action:running",
      "action:complete",
    ]);
  });

  test("turn:complete accumulates usage for finalizeTurn", () => {
    const builder = new TurnEventBuilder();
    const start = builder.startAgentTurn();

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

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "turn:end",
      turnId: start.turnId,
      status: "complete",
      usage: { in: 25, out: 45 },
    });
  });

  test.each([
    [undefined, "complete"],
    ["cancelled" as const, "cancelled"],
    ["error" as const, "error"],
  ])("finalizeTurn(%s) emits %s status", (outcome, status) => {
    const builder = new TurnEventBuilder();
    builder.startAgentTurn();

    const events = builder.finalizeTurn(outcome);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "turn:end", status });
  });

  test("finalizeTurn and handleStreamEvent return empty with no active turn", () => {
    const builder = new TurnEventBuilder();

    expect(builder.finalizeTurn()).toEqual([]);
    expect(builder.handleStreamEvent({ type: "text:start", index: 0 })).toEqual([]);
  });
});
