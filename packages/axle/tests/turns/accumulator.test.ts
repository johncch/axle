import { describe, expect, expectTypeOf, test } from "vitest";
import { TurnAccumulator } from "../../src/turns/accumulator.js";
import type { Annotation, SubagentAction, Turn } from "../../src/turns/types.js";

describe("TurnAccumulator", () => {
  test("accumulates turn events into render state", () => {
    const accumulator = new TurnAccumulator();

    let result = accumulator.apply({ type: "turn:start", turnId: "t1" });
    expect(result.handled).toBe(true);
    expect(result.state.turns).toEqual([
      { id: "t1", owner: "agent", parts: [], status: "streaming" },
    ]);

    result = accumulator.apply({
      type: "part:start",
      turnId: "t1",
      part: { id: "p1", type: "text", text: "" },
    });
    expect(result.state.turns[0].parts).toEqual([{ id: "p1", type: "text", text: "" }]);

    accumulator.apply({ type: "text:delta", turnId: "t1", partId: "p1", delta: "Hello" });
    result = accumulator.apply({ type: "text:delta", turnId: "t1", partId: "p1", delta: " world" });
    expect(result.state.turns[0].parts[0]).toEqual({
      id: "p1",
      type: "text",
      text: "Hello world",
    });

    result = accumulator.apply({
      type: "turn:end",
      turnId: "t1",
      status: "complete",
      usage: { in: 1, out: 2 },
      timing: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:00:01.000Z" },
    });
    expect(result.state.turns[0]).toMatchObject({
      status: "complete",
      usage: { in: 1, out: 2 },
      timing: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:00:01.000Z" },
    });
  });

  test("accumulates action events", () => {
    const accumulator = new TurnAccumulator();

    accumulator.apply({ type: "turn:start", turnId: "t1" });
    accumulator.apply({
      type: "part:start",
      turnId: "t1",
      part: {
        id: "p1",
        type: "action",
        kind: "tool",
        status: "pending",
        detail: { name: "search", parameters: {} },
      },
    });
    accumulator.apply({
      type: "action:args-delta",
      turnId: "t1",
      partId: "p1",
      delta: '{"q":',
      accumulated: '{"q":',
    });
    accumulator.apply({
      type: "action:running",
      turnId: "t1",
      partId: "p1",
      parameters: { q: "axle" },
    });
    accumulator.apply({ type: "action:progress", turnId: "t1", partId: "p1", chunk: "partial" });
    const result = accumulator.apply({
      type: "action:complete",
      turnId: "t1",
      partId: "p1",
      result: { type: "success", content: "done" },
    });

    const part = result.state.turns[0].parts[0];
    expect(part).toMatchObject({
      type: "action",
      kind: "tool",
      status: "complete",
      detail: {
        name: "search",
        parameters: { q: "axle" },
        result: { type: "success", content: "done" },
      },
    });
  });

  test("returns unhandled for unknown host events", () => {
    type HostEvent = { type: "run:terminal"; status: "completed" };
    const accumulator = new TurnAccumulator<Annotation, HostEvent>();
    const state = accumulator.state;
    const result = accumulator.apply({ type: "run:terminal", status: "completed" });

    expect(result.handled).toBe(false);
    expect(result.state).toBe(state);
    if (!result.handled) {
      expectTypeOf(result.event).toEqualTypeOf<HostEvent>();
    }
  });

  test("returns a new state snapshot for handled mutations", () => {
    const accumulator = new TurnAccumulator();
    const first = accumulator.state;
    const result = accumulator.apply({ type: "turn:start", turnId: "t1" });

    expect(result.handled).toBe(true);
    expect(result.state).not.toBe(first);
    expect(accumulator.state).toBe(result.state);
  });

  test("accumulates session, turn, and part annotations", () => {
    type TestAnnotation = Annotation<{ value: number }, "metric">;
    const accumulator = new TurnAccumulator<TestAnnotation>();

    accumulator.apply({ type: "turn:start", turnId: "t1" });
    accumulator.apply({
      type: "part:start",
      turnId: "t1",
      part: { id: "p1", type: "text", text: "" },
    });

    accumulator.apply({
      type: "annotation:start",
      target: { type: "session" },
      annotation: { id: "a1", kind: "metric", label: "Session metric", data: { value: 1 } },
    });
    accumulator.apply({
      type: "annotation:start",
      target: { type: "turn", turnId: "t1" },
      annotation: {
        id: "a2",
        kind: "metric",
        label: "Turn metric",
        placement: "before",
        data: { value: 2 },
      },
    });
    const result = accumulator.apply({
      type: "annotation:start",
      target: { type: "part", turnId: "t1", partId: "p1" },
      annotation: { id: "a3", kind: "metric", label: "Part metric", data: { value: 3 } },
    });

    expect(result.state.sessionAnnotations).toEqual([
      {
        id: "a1",
        kind: "metric",
        label: "Session metric",
        placement: "after",
        data: { value: 1 },
      },
    ]);
    expect(result.state.turns[0].annotations).toEqual([
      {
        id: "a2",
        kind: "metric",
        label: "Turn metric",
        placement: "before",
        data: { value: 2 },
      },
    ]);
    expect(result.state.turns[0].parts[0].annotations).toEqual([
      {
        id: "a3",
        kind: "metric",
        label: "Part metric",
        placement: "after",
        data: { value: 3 },
      },
    ]);
  });

  test("annotation update and end replace the full annotation", () => {
    type TestAnnotation = Annotation<{ score: number }, "eval">;
    const accumulator = new TurnAccumulator<TestAnnotation>();

    accumulator.apply({ type: "turn:start", turnId: "t1" });
    accumulator.apply({
      type: "annotation:start",
      target: { type: "turn", turnId: "t1" },
      annotation: {
        id: "eval-1",
        kind: "eval",
        label: "Evaluating",
        status: "running",
        data: { score: 0 },
      },
    });
    accumulator.apply({
      type: "annotation:update",
      target: { type: "turn", turnId: "t1" },
      annotation: {
        id: "eval-1",
        kind: "eval",
        label: "Eval scored",
        status: "running",
        data: { score: 0.5 },
      },
    });
    const result = accumulator.apply({
      type: "annotation:end",
      target: { type: "turn", turnId: "t1" },
      annotation: {
        id: "eval-1",
        kind: "eval",
        label: "Eval passed",
        data: { score: 1 },
      },
    });

    expect(result.state.turns[0].annotations).toEqual([
      {
        id: "eval-1",
        kind: "eval",
        label: "Eval passed",
        placement: "after",
        status: "complete",
        data: { score: 1 },
      },
    ]);
  });

  test("missing annotation targets are ignored", () => {
    const accumulator = new TurnAccumulator();
    const state = accumulator.state;
    const result = accumulator.apply({
      type: "annotation:start",
      target: { type: "turn", turnId: "missing" },
      annotation: { id: "a1", kind: "note", label: "Note" },
    });

    expect(result.handled).toBe(true);
    expect(result.state).toBe(state);
  });

  test("session restore replaces turns and session annotations", () => {
    const accumulator = new TurnAccumulator();
    accumulator.apply({ type: "turn:start", turnId: "old" });

    const result = accumulator.apply({
      type: "session:restore",
      turns: [{ id: "restored", owner: "user", parts: [], status: "complete" }],
      sessionAnnotations: [{ id: "a1", kind: "note", label: "Restored" }],
    });

    expect(result.state.turns).toEqual([
      { id: "restored", owner: "user", parts: [], status: "complete" },
    ]);
    expect(result.state.sessionAnnotations).toEqual([
      { id: "a1", kind: "note", label: "Restored" },
    ]);
  });

  test("annotation generics preserve consumer data types", () => {
    type AppAnnotation =
      | Annotation<{ image: string }, "sandbox">
      | Annotation<{ score: number; passed: boolean }, "eval">;

    const accumulator = new TurnAccumulator<AppAnnotation>();
    accumulator.apply({
      type: "annotation:start",
      target: { type: "session" },
      annotation: {
        id: "sandbox-1",
        kind: "sandbox",
        label: "Starting sandbox",
        data: { image: "node:22" },
      },
    });

    expectTypeOf(accumulator.state.turns).toEqualTypeOf<Turn<AppAnnotation>[]>();

    const child: Turn<AppAnnotation> = {
      id: "child-turn",
      owner: "agent",
      parts: [],
      status: "complete",
      annotations: [
        {
          id: "eval-1",
          kind: "eval",
          label: "Eval passed",
          data: { score: 1, passed: true },
        },
      ],
    };
    const subagent: SubagentAction<AppAnnotation> = {
      id: "part-1",
      type: "action",
      kind: "agent",
      status: "complete",
      detail: {
        name: "worker",
        children: [child],
      },
    };

    expect(subagent.detail.children[0].annotations?.[0].kind).toBe("eval");

    // @ts-expect-error label is required by the base annotation render contract.
    const _missingLabel: AppAnnotation = { id: "bad", kind: "sandbox", data: { image: "node" } };
  });
});
