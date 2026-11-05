import { afterEach, describe, expect, test, vi } from "vitest";
import { AxleStopReason } from "../../src/protocols/types.js";
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
    events.push(...builder.handleStreamEvent({ type: "text:start" }));
    events.push(
      ...builder.handleStreamEvent({
        type: "text:delta",
        delta: "Hello",
        accumulated: "Hello",
      }),
    );
    events.push(...builder.handleStreamEvent({ type: "text:end", final: "Hello" }));

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

  test("thinking streaming opens a part with no content fields and names the field each delta grows", () => {
    const builder = new TurnEventBuilder();
    const start = builder.startAgentTurn();

    const events: TurnEvent[] = [];
    events.push(
      ...builder.handleStreamEvent({
        type: "thinking:start",
        continuity: { provider: "anthropic", signature: "sig" },
      }),
    );
    events.push(
      ...builder.handleStreamEvent({
        type: "thinking:summary-delta",
        delta: "gist",
        accumulated: "gist",
      }),
    );
    events.push(
      ...builder.handleStreamEvent({
        type: "thinking:raw-delta",
        delta: "chain",
        accumulated: "chain",
      }),
    );
    events.push(
      ...builder.handleStreamEvent({ type: "thinking:end", summary: "gist", raw: "chain" }),
    );

    expect(events.map((event) => event.type)).toEqual([
      "part:start",
      "thinking:summary-delta",
      "thinking:raw-delta",
      "part:end",
    ]);
    const opened = events[0];
    if (opened.type !== "part:start") throw new Error("expected part:start");
    expect(opened.turnId).toBe(start.turnId);
    expect(opened.part).toMatchObject({
      type: "thinking",
      continuity: { provider: "anthropic", signature: "sig" },
    });
    expect(opened.part).not.toHaveProperty("summary");
    expect(opened.part).not.toHaveProperty("raw");
    expect(opened.part).not.toHaveProperty("text");
    expect(opened.part).not.toHaveProperty("redacted");
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
        id: "tc1",
        name: "calculator",
      }),
    );
    events.push(
      ...builder.handleStreamEvent({
        type: "tool:args-delta",
        id: "tc1",
        name: "calculator",
        delta: '{"expression":',
        accumulated: '{"expression":',
      }),
    );
    events.push(
      ...builder.handleStreamEvent({
        type: "tool:exec-start",
        id: "tc1",
        name: "calculator",
        parameters: { expression: "2+2" },
      }),
    );
    vi.advanceTimersByTime(40);
    events.push(
      ...builder.handleStreamEvent({
        type: "tool:exec-complete",
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
    builder.handleStreamEvent({ type: "tool:request", id: "tc1", name: "calculator" });

    const events = builder.handleStreamEvent({
      type: "tool:exec-complete",
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

  test("an aborted tool emits action:cancelled; a fatal one still emits action:error", () => {
    const builder = new TurnEventBuilder();
    builder.startAgentTurn();
    builder.handleStreamEvent({ type: "tool:request", id: "tc1", name: "slow" });
    builder.handleStreamEvent({ type: "tool:request", id: "tc2", name: "strict" });

    const aborted = builder.handleStreamEvent({
      type: "tool:exec-error",
      id: "tc1",
      name: "slow",
      error: { type: "aborted", message: "Operation aborted" },
    });
    const fatal = builder.handleStreamEvent({
      type: "tool:exec-error",
      id: "tc2",
      name: "strict",
      error: { type: "fatal", message: "stop" },
    });

    expect(aborted).toEqual([
      expect.objectContaining({ type: "action:cancelled", partId: expect.any(String) }),
    ]);
    expect(fatal).toEqual([
      expect.objectContaining({
        type: "action:error",
        error: { type: "fatal", message: "stop" },
      }),
    ]);
  });

  test("deferred tool lifecycle: pending, waiting with the validated input, complete", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T12:00:00.000Z"));

    const builder = new TurnEventBuilder();
    const start = builder.startAgentTurn();

    const events: TurnEvent[] = [];
    events.push(
      ...builder.handleStreamEvent({
        type: "tool:request",
        id: "tc1",
        name: "ask-user",
        kind: "deferred",
      }),
    );
    events.push(
      ...builder.handleStreamEvent({
        type: "tool:args-delta",
        id: "tc1",
        name: "ask-user",
        delta: '{"question":',
        accumulated: '{"question":',
      }),
    );
    events.push(
      ...builder.handleStreamEvent({
        type: "tool:exec-start",
        id: "tc1",
        name: "ask-user",
        parameters: { question: "Colour?" },
      }),
    );
    events.push(
      ...builder.handleStreamEvent({
        type: "tool:waiting",
        id: "tc1",
        name: "ask-user",
        input: { question: "Colour?" },
      }),
    );
    vi.advanceTimersByTime(1500);
    events.push(
      ...builder.handleStreamEvent({
        type: "tool:exec-complete",
        id: "tc1",
        name: "ask-user",
        result: { type: "success", content: "blue" },
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      "part:start",
      "action:args-delta",
      "action:waiting",
      "action:complete",
    ]);
    expect(events[0]).toMatchObject({
      type: "part:start",
      turnId: start.turnId,
      part: {
        type: "action",
        kind: "deferred",
        status: "pending",
        detail: { name: "ask-user", callId: "tc1", input: {} },
      },
    });
    expect(events[2]).toMatchObject({ type: "action:waiting", input: { question: "Colour?" } });
    expect(events[3]).toMatchObject({
      type: "action:complete",
      result: { type: "success", content: "blue" },
      timing: { start: "2026-11-05T12:00:00.000Z", end: "2026-11-05T12:00:01.500Z" },
    });
  });

  test("a deferred call that fails validation settles error without waiting", () => {
    const builder = new TurnEventBuilder();
    builder.startAgentTurn();
    builder.handleStreamEvent({
      type: "tool:request",
      id: "tc1",
      name: "ask-user",
      kind: "deferred",
    });
    const started = builder.handleStreamEvent({
      type: "tool:exec-start",
      id: "tc1",
      name: "ask-user",
      parameters: { question: 3 },
    });
    const settled = builder.handleStreamEvent({
      type: "tool:exec-complete",
      id: "tc1",
      name: "ask-user",
      result: { type: "error", error: { type: "validation", message: "bad" } },
    });

    expect(started).toEqual([]);
    expect(settled).toEqual([
      expect.objectContaining({
        type: "action:error",
        error: { type: "validation", message: "bad" },
      }),
    ]);
  });

  test("finalizeTurn cancels a waiting deferred call on a cancelled turn", () => {
    const builder = new TurnEventBuilder();
    builder.startAgentTurn();
    builder.handleStreamEvent({
      type: "tool:request",
      id: "tc1",
      name: "ask-user",
      kind: "deferred",
    });
    builder.handleStreamEvent({ type: "tool:waiting", id: "tc1", name: "ask-user", input: {} });

    const events = builder.finalizeTurn("cancelled");

    expect(events.map((event) => event.type)).toEqual(["action:cancelled", "turn:end"]);
  });

  test("provider tool lifecycle emits action events", () => {
    const builder = new TurnEventBuilder();
    builder.startAgentTurn();

    const events: TurnEvent[] = [];
    events.push(
      ...builder.handleStreamEvent({
        type: "provider-tool:start",
        id: "it1",
        name: "web_search",
      }),
    );
    events.push(
      ...builder.handleStreamEvent({
        type: "provider-tool:complete",
        id: "it1",
        name: "web_search",
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      "part:start",
      "action:running",
      "action:complete",
    ]);
  });

  test("provider tool output reaches the action result", () => {
    const builder = new TurnEventBuilder();
    builder.startAgentTurn();

    builder.handleStreamEvent({ type: "provider-tool:start", id: "it1", name: "code_execution" });
    const events = builder.handleStreamEvent({
      type: "provider-tool:complete",
      id: "it1",
      name: "code_execution",
      output: { stdout: "5117\n", exitCode: 0 },
    });

    expect(events).toMatchObject([
      {
        type: "action:complete",
        result: { type: "success", content: { stdout: "5117\n", exitCode: 0 } },
      },
    ]);
  });

  test("provider tool input reaches the action", () => {
    const builder = new TurnEventBuilder();
    builder.startAgentTurn();

    const [start] = builder.handleStreamEvent({
      type: "provider-tool:start",
      id: "it1",
      name: "web_search",
    });
    const events = builder.handleStreamEvent({
      type: "provider-tool:input",
      id: "it1",
      name: "web_search",
      input: { type: "search", queries: ["axle"] },
    });

    expect(events).toEqual([
      {
        type: "action:input",
        turnId: expect.any(String),
        partId: start.type === "part:start" ? start.part.id : undefined,
        input: { type: "search", queries: ["axle"] },
      },
    ]);
  });

  test("provider tool error emits action:error instead of action:complete", () => {
    const builder = new TurnEventBuilder();
    builder.startAgentTurn();

    builder.handleStreamEvent({ type: "provider-tool:start", id: "it1", name: "web_search" });
    const events = builder.handleStreamEvent({
      type: "provider-tool:error",
      id: "it1",
      name: "web_search",
      error: { type: "max_uses_exceeded", message: "web_search failed: max_uses_exceeded" },
    });

    expect(events).toMatchObject([
      {
        type: "action:error",
        error: { type: "max_uses_exceeded", message: "web_search failed: max_uses_exceeded" },
      },
    ]);
  });

  test("citation stream event emits ordered citation part", () => {
    const builder = new TurnEventBuilder();
    builder.startAgentTurn();

    const citation = {
      source: { type: "web" as const, title: "Example", url: "https://example.com" },
    };
    const events = builder.handleStreamEvent({
      type: "citation",
      citations: [citation],
    });

    expect(events.map((event) => event.type)).toEqual(["part:start", "part:end"]);
    expect(events[0]).toMatchObject({
      type: "part:start",
      part: {
        type: "citation",
        citations: [citation],
      },
    });
  });

  test("step:complete accumulates usage for finalizeTurn", () => {
    const builder = new TurnEventBuilder();
    const start = builder.startAgentTurn();

    builder.handleStreamEvent({
      type: "step:complete",
      message: {
        role: "assistant",
        id: "a1",
        model: "test-model",
        content: [{ type: "text", text: "Hi" }],
        finishReason: AxleStopReason.FunctionCall,
      },
      usage: { in: 10, out: 20, breakdown: [] },
    });
    builder.handleStreamEvent({
      type: "step:complete",
      message: {
        role: "assistant",
        id: "a2",
        model: "test-model",
        content: [{ type: "text", text: "Done" }],
        finishReason: AxleStopReason.Stop,
      },
      usage: { in: 15, out: 25, breakdown: [] },
    });

    const events = builder.finalizeTurn();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "turn:end",
      turnId: start.turnId,
      status: "complete",
      usage: { in: 25, out: 45, breakdown: [] },
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

  test.each(["cancelled" as const, "error" as const])(
    "finalizeTurn(%s) cancels actions that never settled, before turn:end",
    (outcome) => {
      const builder = new TurnEventBuilder();
      builder.startAgentTurn();
      const [pending] = builder.handleStreamEvent({
        type: "tool:request",
        id: "tc1",
        name: "search",
      });
      const [running] = builder.handleStreamEvent({
        type: "provider-tool:start",
        id: "pt1",
        name: "web_search",
      });
      builder.handleStreamEvent({ type: "tool:request", id: "tc2", name: "done" });
      builder.handleStreamEvent({
        type: "tool:exec-complete",
        id: "tc2",
        name: "done",
        result: { type: "success", content: "ok" },
      });

      const events = builder.finalizeTurn(outcome);

      const partIdOf = (event: TurnEvent | undefined) =>
        event?.type === "part:start" ? event.part.id : undefined;
      expect(events.map((event) => event.type)).toEqual([
        "action:cancelled",
        "action:cancelled",
        "turn:end",
      ]);
      expect(events.slice(0, 2).map((event) => "partId" in event && event.partId)).toEqual([
        partIdOf(pending),
        partIdOf(running),
      ]);
    },
  );

  describe("reason on turn:end", () => {
    function step(finishReason: AxleStopReason) {
      return {
        type: "step:complete" as const,
        message: {
          role: "assistant" as const,
          id: crypto.randomUUID(),
          content: [],
          finishReason,
        },
      };
    }

    test("is the final answer's finish: stop or length", () => {
      for (const [finish, reason] of [
        [AxleStopReason.Stop, "stop"],
        [AxleStopReason.Length, "length"],
      ] as const) {
        const builder = new TurnEventBuilder();
        builder.startAgentTurn();
        builder.handleStreamEvent(step(AxleStopReason.FunctionCall));
        builder.handleStreamEvent(step(finish));

        expect(builder.finalizeTurn().at(-1)).toMatchObject({ type: "turn:end", reason });
      }
    });

    test("stays on a turn that failed after its final answer arrived", () => {
      const builder = new TurnEventBuilder();
      builder.startAgentTurn();
      builder.handleStreamEvent(step(AxleStopReason.Length));

      const end = builder.finalizeTurn("error", {
        kind: "parse",
        message: "Expected '}'",
        cause: new Error("Expected '}'"),
      });

      expect(end.at(-1)).toMatchObject({ status: "error", reason: "length" });
    });

    test("is absent when the turn ended before a final answer", () => {
      const builder = new TurnEventBuilder();
      builder.startAgentTurn();
      builder.handleStreamEvent(step(AxleStopReason.FunctionCall));

      expect(builder.finalizeTurn("error").at(-1)).not.toHaveProperty("reason");
    });

    test("does not carry over to the next turn", () => {
      const builder = new TurnEventBuilder();
      builder.startAgentTurn();
      builder.handleStreamEvent(step(AxleStopReason.Stop));
      builder.finalizeTurn();
      builder.startAgentTurn();

      expect(builder.finalizeTurn("cancelled").at(-1)).not.toHaveProperty("reason");
    });
  });

  test("finalizeTurn() on a complete turn leaves unsettled actions alone", () => {
    const builder = new TurnEventBuilder();
    builder.startAgentTurn();
    builder.handleStreamEvent({ type: "provider-tool:start", id: "pt1", name: "web_search" });

    const events = builder.finalizeTurn();

    expect(events.map((event) => event.type)).toEqual(["turn:end"]);
  });

  test("finalizeTurn and handleStreamEvent return empty with no active turn", () => {
    const builder = new TurnEventBuilder();

    expect(builder.finalizeTurn()).toEqual([]);
    expect(builder.handleStreamEvent({ type: "text:start" })).toEqual([]);
  });
});
