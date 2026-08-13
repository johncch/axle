import { describe, expect, expectTypeOf, test } from "vitest";
import { Transcript } from "../../src/turns/transcript.js";
import type { Annotation, SubagentAction, Turn } from "../../src/turns/types.js";

describe("Transcript", () => {
  test("gets the current turn by id", () => {
    const transcript = new Transcript();

    transcript.apply({ type: "turn:start", turnId: "t1" });
    transcript.apply({
      type: "part:start",
      turnId: "t1",
      part: { id: "p1", type: "text", text: "current" },
    });

    expect(transcript.getTurn("t1")).toEqual({
      id: "t1",
      owner: "agent",
      parts: [{ id: "p1", type: "text", text: "current" }],
      status: "streaming",
    });
    expect(transcript.getTurn("missing")).toBeUndefined();
  });

  test("accumulates turn events into render state", () => {
    const transcript = new Transcript();

    const result = transcript.apply({ type: "turn:start", turnId: "t1" });
    expect(result.handled).toBe(true);
    expect(transcript.turns).toEqual([
      { id: "t1", owner: "agent", parts: [], status: "streaming" },
    ]);

    transcript.apply({
      type: "part:start",
      turnId: "t1",
      part: { id: "p1", type: "text", text: "" },
    });
    expect((transcript.turns[0] as Turn).parts).toEqual([{ id: "p1", type: "text", text: "" }]);

    transcript.apply({ type: "text:delta", turnId: "t1", partId: "p1", delta: "Hello" });
    transcript.apply({ type: "text:delta", turnId: "t1", partId: "p1", delta: " world" });
    expect((transcript.turns[0] as Turn).parts[0]).toEqual({
      id: "p1",
      type: "text",
      text: "Hello world",
    });

    transcript.apply({
      type: "turn:end",
      turnId: "t1",
      status: "complete",
      usage: { in: 1, out: 2 },
      timing: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:00:01.000Z" },
    });
    expect(transcript.turns[0]).toMatchObject({
      status: "complete",
      usage: { in: 1, out: 2 },
      timing: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:00:01.000Z" },
    });
  });

  test("retains model errors on their turn", () => {
    const transcript = new Transcript();
    transcript.apply({ type: "turn:start", turnId: "t1" });

    transcript.apply({
      type: "error",
      turnId: "t1",
      error: { type: "model", message: "Rate limit exceeded" },
    });

    expect(transcript.turns[0]).toMatchObject({
      id: "t1",
      error: { type: "model", message: "Rate limit exceeded" },
    });
  });

  test("accumulates action events", () => {
    const transcript = new Transcript();

    transcript.apply({ type: "turn:start", turnId: "t1" });
    transcript.apply({
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
    transcript.apply({
      type: "action:args-delta",
      turnId: "t1",
      partId: "p1",
      delta: '{"q":',
      accumulated: '{"q":',
    });
    transcript.apply({
      type: "action:running",
      turnId: "t1",
      partId: "p1",
      parameters: { q: "axle" },
    });
    transcript.apply({ type: "action:progress", turnId: "t1", partId: "p1", chunk: "partial" });
    transcript.apply({
      type: "action:complete",
      turnId: "t1",
      partId: "p1",
      result: { type: "success", content: "done" },
    });

    const part = (transcript.turns[0] as Turn).parts[0];
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

  test("accumulates citations and thinking summary metadata", () => {
    const transcript = new Transcript();

    transcript.apply({ type: "turn:start", turnId: "t1" });
    transcript.apply({
      type: "part:start",
      turnId: "t1",
      part: { id: "p1", type: "text", text: "" },
    });
    transcript.apply({ type: "text:delta", turnId: "t1", partId: "p1", delta: "OpenAI" });
    transcript.apply({
      type: "text:citation",
      turnId: "t1",
      partId: "p1",
      citation: { source: { type: "web", title: "OpenAI", url: "https://openai.com" } },
    });
    transcript.apply({
      type: "part:start",
      turnId: "t1",
      part: { id: "p2", type: "thinking", summary: "", redacted: false },
    });
    transcript.apply({
      type: "thinking:summary-delta",
      turnId: "t1",
      partId: "p2",
      delta: "Checked sources.",
    });
    transcript.apply({
      type: "thinking:update",
      turnId: "t1",
      partId: "p2",
      continuity: { provider: "openai", encrypted: "encrypted" },
    });

    expect((transcript.turns[0] as Turn).parts[0]).toMatchObject({
      type: "text",
      text: "OpenAI",
      citations: [{ source: { type: "web", title: "OpenAI", url: "https://openai.com" } }],
    });
    expect((transcript.turns[0] as Turn).parts[1]).toMatchObject({
      type: "thinking",
      summary: "Checked sources.",
      redacted: false,
      continuity: { provider: "openai", encrypted: "encrypted" },
    });
  });

  test("accumulates citation parts", () => {
    const transcript = new Transcript();
    const citation = {
      source: { type: "web" as const, title: "Example", url: "https://example.com" },
    };

    transcript.apply({ type: "turn:start", turnId: "t1" });
    transcript.apply({
      type: "part:start",
      turnId: "t1",
      part: { id: "p1", type: "citation", citations: [citation] },
    });

    expect((transcript.turns[0] as Turn).parts[0]).toMatchObject({
      type: "citation",
      citations: [citation],
    });
  });

  test("returns unhandled for unknown host events", () => {
    type HostEvent = { type: "run:terminal"; status: "completed" };
    const transcript = new Transcript<Annotation, HostEvent>();
    const turns = transcript.turns;
    const result = transcript.apply({ type: "run:terminal", status: "completed" });

    expect(result.handled).toBe(false);
    expect(transcript.turns).toBe(turns);
    if (result.handled === false) {
      const hostEvent: HostEvent = result.event;
      expect(hostEvent).toEqual({ type: "run:terminal", status: "completed" });
    }
  });

  test("replaces the turn snapshot for handled mutations", () => {
    const transcript = new Transcript();
    const first = transcript.turns;
    const result = transcript.apply({ type: "turn:start", turnId: "t1" });

    expect(result.handled).toBe(true);
    expect(transcript.turns).not.toBe(first);
  });

  test("accumulates turn and part annotations", () => {
    type TestAnnotation = Annotation<{ value: number }, "metric">;
    const transcript = new Transcript<TestAnnotation>();

    transcript.apply({ type: "turn:start", turnId: "t1" });
    transcript.apply({
      type: "part:start",
      turnId: "t1",
      part: { id: "p1", type: "text", text: "" },
    });

    transcript.apply({
      type: "annotation:start",
      target: { type: "turn", turnId: "t1" },
      annotation: {
        id: "a1",
        kind: "metric",
        label: "Turn metric",
        placement: "before",
        data: { value: 1 },
      },
    });
    transcript.apply({
      type: "annotation:start",
      target: { type: "part", turnId: "t1", partId: "p1" },
      annotation: { id: "a2", kind: "metric", label: "Part metric", data: { value: 2 } },
    });

    expect((transcript.turns[0] as Turn).annotations).toEqual([
      {
        id: "a1",
        kind: "metric",
        label: "Turn metric",
        placement: "before",
        data: { value: 1 },
      },
    ]);
    expect((transcript.turns[0] as Turn).parts[0].annotations).toEqual([
      {
        id: "a2",
        kind: "metric",
        label: "Part metric",
        placement: "after",
        data: { value: 2 },
      },
    ]);
  });

  test("annotation update and end replace the full annotation", () => {
    type TestAnnotation = Annotation<{ score: number }, "eval">;
    const transcript = new Transcript<TestAnnotation>();

    transcript.apply({ type: "turn:start", turnId: "t1" });
    transcript.apply({
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
    transcript.apply({
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
    transcript.apply({
      type: "annotation:end",
      target: { type: "turn", turnId: "t1" },
      annotation: {
        id: "eval-1",
        kind: "eval",
        label: "Eval passed",
        data: { score: 1 },
      },
    });

    expect((transcript.turns[0] as Turn).annotations).toEqual([
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
    const transcript = new Transcript();
    const turns = transcript.turns;
    const result = transcript.apply({
      type: "annotation:start",
      target: { type: "turn", turnId: "missing" },
      annotation: { id: "a1", kind: "note", label: "Note" },
    });

    expect(result.handled).toBe(true);
    expect(transcript.turns).toBe(turns);
  });

  test("compaction updates replace transient state and completion supplies final state", () => {
    const transcript = new Transcript();
    transcript.apply({ type: "turn:start", turnId: "t1" });
    transcript.apply({
      type: "part:start",
      turnId: "t1",
      part: { id: "c1", type: "compaction", status: "running" },
    });
    transcript.apply({
      type: "compaction:update",
      turnId: "t1",
      partId: "c1",
      update: { summary: "draft summary…" },
    });
    transcript.apply({
      type: "compaction:update",
      turnId: "t1",
      partId: "c1",
      update: { summary: "current summary", progress: 0.5 },
    });
    expect((transcript.turns[0] as Turn).parts[0]).toMatchObject({
      type: "compaction",
      status: "running",
      summary: "current summary",
      progress: 0.5,
    });

    transcript.apply({
      type: "compaction:complete",
      turnId: "t1",
      partId: "c1",
      summary: "final stamped summary",
      timing: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:00:30.000Z" },
    });
    expect((transcript.turns[0] as Turn).parts[0]).toMatchObject({
      type: "compaction",
      status: "complete",
      summary: "final stamped summary",
      progress: 1,
      timing: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:00:30.000Z" },
    });
  });

  test("compaction parts settle error with the failure message, keeping transient state", () => {
    const transcript = new Transcript();
    transcript.apply({ type: "turn:start", turnId: "t1" });
    transcript.apply({
      type: "part:start",
      turnId: "t1",
      part: { id: "c1", type: "compaction", status: "running" },
    });
    transcript.apply({
      type: "compaction:update",
      turnId: "t1",
      partId: "c1",
      update: { summary: "partial", progress: 0.4 },
    });

    transcript.apply({
      type: "compaction:error",
      turnId: "t1",
      partId: "c1",
      error: "summarizer down",
    });

    expect((transcript.turns[0] as Turn).parts[0]).toMatchObject({
      type: "compaction",
      status: "error",
      summary: "partial",
      progress: 0.4,
      error: "summarizer down",
    });
  });

  test("compaction completion without a summary keeps the latest transient summary", () => {
    const transcript = new Transcript();
    transcript.apply({ type: "turn:start", turnId: "t1" });
    transcript.apply({
      type: "part:start",
      turnId: "t1",
      part: { id: "c1", type: "compaction", status: "running" },
    });
    transcript.apply({
      type: "compaction:update",
      turnId: "t1",
      partId: "c1",
      update: { summary: "Compacting history…", progress: 0.5 },
    });

    transcript.apply({
      type: "compaction:complete",
      turnId: "t1",
      partId: "c1",
    });

    expect((transcript.turns[0] as Turn).parts[0]).toMatchObject({
      type: "compaction",
      status: "complete",
      summary: "Compacting history…",
      progress: 1,
    });
  });

  test("constructor seeding restores persisted state and new events append to it", () => {
    const saved = new Transcript();
    saved.apply({
      type: "turn:user",
      turn: { id: "restored", owner: "user", parts: [], status: "complete" },
    });
    const savedTurns = [...saved.turns];
    const restored = new Transcript(savedTurns);
    savedTurns.length = 0;
    restored.apply({ type: "turn:start", turnId: "next" });

    expect(restored.turns.map((turn) => turn.id)).toEqual(["restored", "next"]);
  });

  test("annotation generics preserve consumer data types", () => {
    type AppAnnotation =
      | Annotation<{ image: string }, "sandbox">
      | Annotation<{ score: number; passed: boolean }, "eval">;

    const transcript = new Transcript<AppAnnotation>();
    transcript.apply({ type: "turn:start", turnId: "t1" });
    transcript.apply({
      type: "annotation:start",
      target: { type: "turn", turnId: "t1" },
      annotation: {
        id: "sandbox-1",
        kind: "sandbox",
        label: "Starting sandbox",
        data: { image: "node:22" },
      },
    });

    expectTypeOf(transcript.turns).toEqualTypeOf<readonly Turn<AppAnnotation>[]>();

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

    expect((subagent.detail.children[0] as Turn<AppAnnotation>).annotations?.[0].kind).toBe("eval");

    // @ts-expect-error label is required by the base annotation render contract.
    const _missingLabel: AppAnnotation = { id: "bad", kind: "sandbox", data: { image: "node" } };
  });
});
