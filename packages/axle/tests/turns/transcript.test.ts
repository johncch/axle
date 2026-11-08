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
      usage: { in: 1, out: 2, breakdown: [] },
      timing: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:00:01.000Z" },
    });
    expect(transcript.turns[0]).toMatchObject({
      status: "complete",
      usage: { in: 1, out: 2, breakdown: [] },
      timing: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:00:01.000Z" },
    });
  });

  test("records the failure turn:end carries on the turn", () => {
    const transcript = new Transcript();
    transcript.apply({ type: "turn:start", turnId: "t1" });

    transcript.apply({
      type: "turn:end",
      turnId: "t1",
      status: "error",
      usage: { in: 0, out: 0, breakdown: [] },
      failure: {
        kind: "api",
        type: "rate_limit_error",
        message: "Rate limit exceeded",
        status: 429,
      },
    });

    expect(transcript.turns[0]).toMatchObject({
      id: "t1",
      status: "error",
      failure: {
        kind: "api",
        type: "rate_limit_error",
        message: "Rate limit exceeded",
        status: 429,
      },
    });
  });

  test("records the reason turn:end carries on the turn", () => {
    const transcript = new Transcript();
    transcript.apply({ type: "turn:start", turnId: "t1" });

    transcript.apply({
      type: "turn:end",
      turnId: "t1",
      status: "complete",
      usage: { in: 0, out: 0, breakdown: [] },
      reason: "length",
    });

    expect(transcript.turns[0]).toMatchObject({ status: "complete", reason: "length" });
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

  test("folds a deferred action: args, waiting with input, then the answer", () => {
    const transcript = new Transcript();
    transcript.apply({ type: "turn:start", turnId: "t1" });
    transcript.apply({
      type: "part:start",
      turnId: "t1",
      part: {
        id: "p1",
        type: "action",
        kind: "deferred",
        status: "pending",
        detail: { name: "ask-user", callId: "call_1", input: {} },
      },
    });
    transcript.apply({
      type: "action:args-delta",
      turnId: "t1",
      partId: "p1",
      delta: '{"question":',
      accumulated: '{"question":',
    });
    expect((transcript.turns[0] as Turn).parts[0]).toMatchObject({
      status: "pending",
      detail: { pendingArgs: '{"question":' },
    });

    transcript.apply({ type: "action:running", turnId: "t1", partId: "p1", parameters: { x: 1 } });
    expect((transcript.turns[0] as Turn).parts[0]).toMatchObject({ status: "pending" });

    transcript.apply({
      type: "action:waiting",
      turnId: "t1",
      partId: "p1",
      callId: "call_1",
      name: "ask-user",
      input: { question: "Colour?" },
    });
    expect((transcript.turns[0] as Turn).parts[0]).toEqual({
      id: "p1",
      type: "action",
      kind: "deferred",
      status: "waiting",
      detail: { name: "ask-user", callId: "call_1", input: { question: "Colour?" } },
    });

    transcript.apply({
      type: "action:complete",
      turnId: "t1",
      partId: "p1",
      result: { type: "success", content: "blue" },
    });
    expect((transcript.turns[0] as Turn).parts[0]).toMatchObject({
      status: "complete",
      detail: { input: { question: "Colour?" }, result: { type: "success", content: "blue" } },
    });
  });

  test("action:waiting leaves a non-deferred part alone", () => {
    const transcript = new Transcript();
    transcript.apply({ type: "turn:start", turnId: "t1" });
    transcript.apply({
      type: "part:start",
      turnId: "t1",
      part: {
        id: "p1",
        type: "action",
        kind: "tool",
        status: "running",
        detail: { name: "search", parameters: { q: "axle" } },
      },
    });
    transcript.apply({
      type: "action:waiting",
      turnId: "t1",
      partId: "p1",
      callId: "call_1",
      name: "search",
      input: { q: "no" },
    });
    expect((transcript.turns[0] as Turn).parts[0]).toMatchObject({
      status: "running",
      detail: { parameters: { q: "axle" } },
    });
  });

  test("action:cancelled settles the part cancelled and keeps what it had", () => {
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
      type: "action:running",
      turnId: "t1",
      partId: "p1",
      parameters: { q: "axle" },
    });
    transcript.apply({
      type: "action:cancelled",
      turnId: "t1",
      partId: "p1",
      timing: { start: "2026-11-02T00:00:00.000Z", end: "2026-11-02T00:00:01.000Z" },
    });

    const part = (transcript.turns[0] as Turn).parts[0];
    expect(part).toMatchObject({
      type: "action",
      status: "cancelled",
      detail: { name: "search", parameters: { q: "axle" } },
      timing: { end: "2026-11-02T00:00:01.000Z" },
    });
    expect(part.type === "action" && part.detail.result).toBeUndefined();
  });

  test("records a provider tool's input on its action", () => {
    const transcript = new Transcript();

    transcript.apply({ type: "turn:start", turnId: "t1" });
    transcript.apply({
      type: "part:start",
      turnId: "t1",
      part: {
        id: "p1",
        type: "action",
        kind: "provider-tool",
        status: "running",
        detail: { name: "web_search" },
      },
    });
    transcript.apply({
      type: "action:input",
      turnId: "t1",
      partId: "p1",
      input: { type: "search", queries: ["axle"] },
    });

    expect((transcript.turns[0] as Turn).parts[0]).toMatchObject({
      status: "running",
      detail: { name: "web_search", input: { type: "search", queries: ["axle"] } },
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
      part: { id: "p2", type: "thinking" },
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
      continuity: { provider: "openai", encrypted: "encrypted" },
    });
    expect((transcript.turns[0] as Turn).parts[1]).not.toHaveProperty("raw");
    expect((transcript.turns[0] as Turn).parts[1]).not.toHaveProperty("redacted");
  });

  test("raw and summary deltas accumulate into separate thinking fields", () => {
    const transcript = new Transcript();
    transcript.apply({ type: "turn:start", turnId: "t1", timing: { start: "2026-01-01" } });
    transcript.apply({
      type: "part:start",
      turnId: "t1",
      part: { id: "p1", type: "thinking" },
    });
    transcript.apply({ type: "thinking:raw-delta", turnId: "t1", partId: "p1", delta: "Let me " });
    transcript.apply({
      type: "thinking:summary-delta",
      turnId: "t1",
      partId: "p1",
      delta: "Short.",
    });
    transcript.apply({ type: "thinking:raw-delta", turnId: "t1", partId: "p1", delta: "think." });

    expect((transcript.turns[0] as Turn).parts[0]).toEqual({
      id: "p1",
      type: "thinking",
      raw: "Let me think.",
      summary: "Short.",
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

  test("reports lifecycle events handled and leaves the turns alone", () => {
    const transcript = new Transcript();
    const turns = transcript.turns;
    const events = [
      { type: "operation:start", id: "u1", kind: "send" },
      { type: "after:start", id: "u1" },
      { type: "after:end", id: "u1" },
      { type: "operation:end", id: "u1", outcome: { type: "complete" } },
      { type: "agent:idle" },
    ] as const;

    for (const event of events) expect(transcript.apply(event)).toEqual({ handled: true, event });
    expect(transcript.turns).toBe(turns);
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
      part: { id: "c1", type: "compaction", trigger: "beforeTurn", status: "running" },
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
      part: { id: "c1", type: "compaction", trigger: "beforeTurn", status: "running" },
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

  test("compaction:cancelled settles the part cancelled with no error", () => {
    const transcript = new Transcript();
    transcript.apply({ type: "turn:start", turnId: "t1" });
    transcript.apply({
      type: "part:start",
      turnId: "t1",
      part: { id: "c1", type: "compaction", trigger: "manual", status: "running" },
    });

    transcript.apply({ type: "compaction:cancelled", turnId: "t1", partId: "c1" });

    const part = (transcript.turns[0] as Turn).parts[0];
    expect(part).toMatchObject({ type: "compaction", trigger: "manual", status: "cancelled" });
    expect(part).not.toHaveProperty("error");
  });

  test("compaction completion without a summary keeps the latest transient summary", () => {
    const transcript = new Transcript();
    transcript.apply({ type: "turn:start", turnId: "t1" });
    transcript.apply({
      type: "part:start",
      turnId: "t1",
      part: { id: "c1", type: "compaction", trigger: "beforeTurn", status: "running" },
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

  describe("pending entries", () => {
    const pendingUser = (id: string) =>
      ({ id, owner: "user", parts: [], status: "pending" }) as const satisfies Turn;
    const pendingCompaction = (id: string) =>
      ({
        id,
        owner: "agent",
        parts: [{ id, type: "compaction", trigger: "manual", status: "pending" }],
        status: "pending",
      }) as const satisfies Turn;
    const queuedSend = (id: string) => ({ type: "pending:queued", turn: pendingUser(id) }) as const;
    const queuedCompaction = (id: string) =>
      ({ type: "pending:queued", turn: pendingCompaction(id) }) as const;

    test("a queued send is pending and absent from turns", () => {
      const transcript = new Transcript();

      const result = transcript.apply(queuedSend("u1"));

      expect(result.handled).toBe(true);
      expect(transcript.pending).toEqual([pendingUser("u1")]);
      expect(transcript.turns).toEqual([]);
    });

    test("a send leaves pending when its user turn commits", () => {
      const transcript = new Transcript();
      transcript.apply(queuedSend("u1"));
      transcript.apply(queuedSend("u2"));

      transcript.apply({
        type: "turn:user",
        turn: { id: "u1", owner: "user", parts: [], status: "complete" },
      });

      expect(transcript.pending.map((turn) => turn.id)).toEqual(["u2"]);
      expect(transcript.turns.map((turn) => turn.id)).toEqual(["u1"]);
    });

    test("a compaction leaves pending when its agent turn starts", () => {
      const transcript = new Transcript();
      transcript.apply(queuedCompaction("c1"));

      transcript.apply({ type: "turn:start", turnId: "c1" });

      expect(transcript.pending).toEqual([]);
      expect(transcript.turns.map((turn) => turn.id)).toEqual(["c1"]);
    });

    test("a dropped entry leaves pending without reaching turns", () => {
      const transcript = new Transcript();
      transcript.apply(queuedSend("u1"));
      transcript.apply(queuedCompaction("c1"));
      transcript.apply(queuedSend("u2"));

      transcript.apply({ type: "pending:dropped", id: "c1", reason: { type: "cancelled" } });
      transcript.apply({
        type: "pending:dropped",
        id: "u1",
        reason: { type: "error", error: { type: "mcp", message: "unreachable" } },
      });

      expect(transcript.pending.map((turn) => turn.id)).toEqual(["u2"]);
      expect(transcript.turns).toEqual([]);
    });

    test("seeded pending turns mirror a live transcript and resolve like queued ones", () => {
      const transcript = new Transcript([], [pendingUser("u1"), pendingCompaction("c1")]);
      expect(transcript.pending.map((turn) => turn.id)).toEqual(["u1", "c1"]);
      expect(transcript.turns).toEqual([]);

      transcript.apply({
        type: "turn:user",
        turn: { id: "u1", owner: "user", parts: [], status: "complete" },
      });
      transcript.apply({ type: "pending:dropped", id: "c1", reason: { type: "cancelled" } });

      expect(transcript.pending).toEqual([]);
      expect(transcript.turns.map((turn) => turn.id)).toEqual(["u1"]);
    });

    test("a seeded pending turn whose turn is already in turns is discarded", () => {
      const transcript = new Transcript(
        [{ id: "u1", owner: "user", parts: [], status: "complete" }],
        [pendingUser("u1"), pendingUser("u2")],
      );

      expect(transcript.pending.map((turn) => turn.id)).toEqual(["u2"]);
      expect(transcript.turns.map((turn) => turn.id)).toEqual(["u1"]);
    });

    test("an unrelated turn leaves pending entries in place", () => {
      const transcript = new Transcript();
      transcript.apply(queuedSend("u1"));
      const before = transcript.pending;

      transcript.apply({ type: "turn:start", turnId: "other" });

      expect(transcript.pending).toBe(before);
    });

    test("a transcript restored from saved turns has nothing pending", () => {
      const saved = new Transcript();
      saved.apply({
        type: "turn:user",
        turn: { id: "u1", owner: "user", parts: [], status: "complete" },
      });
      saved.apply(queuedSend("u2"));

      const restored = new Transcript(saved.turns);

      expect(restored.turns.map((turn) => turn.id)).toEqual(["u1"]);
      expect(restored.pending).toEqual([]);
    });
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
