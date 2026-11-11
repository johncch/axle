import type { Turn, TurnEvent } from "@fifthrevision/axle/ui";
import { Transcript } from "@fifthrevision/axle/ui";
import { renderToString } from "ink";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { App } from "../../src/ui/ink/App.js";
import type { UiState } from "../../src/ui/ink/store.js";
import { createCommitLog, partitionTurns, UiStore } from "../../src/ui/ink/store.js";

function textPart(id: string, text: string) {
  return { id, type: "text" as const, text };
}

function userTurn(id: string, text: string): Turn {
  return { id, owner: "user", status: "complete", parts: [textPart(`${id}-p`, text)] };
}

function createHarness() {
  const transcript = new Transcript();
  const log = createCommitLog();
  const feed = (event: TurnEvent) => {
    transcript.apply(event);
    return partitionTurns(transcript.turns, log);
  };
  const text = (delta: string) => feed({ type: "text:delta", turnId: "t1", partId: "p1", delta });
  return { feed, text };
}

describe("UiStore", () => {
  it("notifies subscribers and swaps state immutably", () => {
    const store = new UiStore<UiState>({
      staticItems: [],
      awaitingInput: false,
      pending: [],
      queuedInputs: [],
    });
    const before = store.getSnapshot();
    let notified = 0;
    const unsubscribe = store.subscribe(() => notified++);

    store.update((state) => ({
      ...state,
      staticItems: [...state.staticItems, { kind: "runner", level: "info", text: "hi" }],
    }));

    expect(notified).toBe(1);
    expect(store.getSnapshot()).not.toBe(before);
    expect(store.getSnapshot().staticItems).toHaveLength(1);

    unsubscribe();
    store.update((state) => state);
    expect(notified).toBe(1);
  });
});

describe("App", () => {
  it("shows a user turn as it was displayed in the input, not as it was sent", () => {
    const turn: Turn = {
      ...userTurn("u1", "why does this fail?\nline 1\nline 2\nline 3\nline 4\nline 5\nline 6"),
      metadata: { display: "why does this fail? [Pasted 6 lines]" },
    };
    const store = new UiStore<UiState>({
      staticItems: [{ kind: "turn", turn }],
      awaitingInput: false,
      pending: [],
      queuedInputs: [],
    });

    const output = renderToString(createElement(App, { store, statusBar: false, onSubmit() {} }));

    expect(output).toContain("❯ why does this fail? [Pasted 6 lines]");
    expect(output).not.toContain("line 6");
  });

  it("omits the status bar when it is disabled for a non-interactive run", () => {
    const row = {
      model: "m",
      requestedModel: "m",
      at: "2026-10-30T12:00:00.000Z",
      in: 300,
      out: 60,
    };
    const priced = { ...row, usd: 0.1405 };
    const unpriced = { ...row, reason: "no-provider" as const };
    const store = new UiStore<UiState>({
      staticItems: [],
      awaitingInput: false,
      pending: [],
      queuedInputs: [],
      usage: {
        usage: { in: 1_000, out: 200, breakdown: [] },
        cost: { usd: 0.4215, priced: [priced, priced, priced], unpriced: [unpriced] },
        contextTokens: 4_000,
        contextLimit: 10_000,
      },
    });
    const renderApp = (statusBar: boolean) =>
      renderToString(createElement(App, { store, statusBar, onSubmit() {} }));

    expect(renderApp(true)).toContain("↑ 1.0k ↓ 200 · $0.42 (1 unpriced)");
    expect(renderApp(false)).not.toContain("↑ 1.0k ↓ 200");
  });

  it("renders agent replies as markdown, settled or streaming", () => {
    const markdown = "# Title\n\nSome **bold** text.";
    const agentTurn = (id: string): Turn => ({
      id,
      owner: "agent",
      status: "complete",
      parts: [
        { id: `${id}-think`, type: "thinking", summary: "**Plan**\n\nRead the file first." },
        textPart(`${id}-p`, markdown),
      ],
    });
    const settled = new UiStore<UiState>({
      staticItems: [{ kind: "turn", turn: agentTurn("a1") }],
      awaitingInput: false,
      pending: [],
      queuedInputs: [],
    });
    const streaming = new UiStore<UiState>({
      staticItems: [],
      liveTurn: { ...agentTurn("a2"), status: "streaming" },
      awaitingInput: false,
      pending: [],
      queuedInputs: [],
    });
    const render = (store: UiStore<UiState>) =>
      renderToString(createElement(App, { store, statusBar: false, onSubmit() {} }));

    expect(render(settled)).toContain("Title\n\nSome bold text.");
    expect(render(settled)).not.toContain("**");
    expect(render(settled)).toContain("✔ Thinking — Plan\n\n  Read the file first.");
    expect(render(streaming)).toContain("Some bold text.");
    expect(render(streaming)).not.toContain("**");
  });

  it("caps a long streaming block at a height that never shrinks", () => {
    const reply = Array.from({ length: 400 }, (_, word) => `word${word}`).join(" ");
    const heights: number[] = [];
    for (let length = 40; length <= reply.length; length += 40) {
      const store = new UiStore<UiState>({
        staticItems: [],
        liveTurn: {
          id: "a1",
          owner: "agent",
          status: "streaming",
          parts: [textPart("a1-p", reply.slice(0, length))],
        },
        awaitingInput: false,
        pending: [],
        queuedInputs: [],
        closed: true,
      });
      const output = renderToString(
        createElement(App, { store, statusBar: false, onSubmit() {} }),
        { columns: 80 },
      );
      heights.push(output.split("\n").length);
    }

    // The cap is half the terminal's rows, held between 6 and 20; uncapped, the block is 35 rows.
    expect(Math.max(...heights)).toBeGreaterThanOrEqual(6);
    expect(Math.max(...heights)).toBeLessThanOrEqual(20);
    expect(heights.every((height, index) => index === 0 || height >= heights[index - 1])).toBe(
      true,
    );
  });

  it("separates text that continues in a later scrollback item with a blank line", () => {
    const slice = (text: string): Turn => ({
      id: "a1",
      owner: "agent",
      status: "streaming",
      parts: [textPart("a1-p", text)],
    });
    const store = new UiStore<UiState>({
      staticItems: [
        { kind: "turn", turn: slice("First paragraph.\n\n") },
        { kind: "turn", turn: slice("Second paragraph.\n\n"), continues: true },
      ],
      liveTurn: slice("Third"),
      liveContinues: true,
      awaitingInput: false,
      pending: [],
      queuedInputs: [],
      closed: true,
    });

    const output = renderToString(createElement(App, { store, statusBar: false, onSubmit() {} }));

    expect(output).toBe("First paragraph.\n\nSecond paragraph.\n\nThird");
  });

  it("sets each user message off with a blank line above and below", () => {
    const agentTurn: Turn = {
      id: "a1",
      owner: "agent",
      status: "complete",
      parts: [textPart("a1-p", "and that is why the test fails.")],
    };
    const store = new UiStore<UiState>({
      staticItems: [
        { kind: "turn", turn: userTurn("u1", "why?") },
        { kind: "turn", turn: agentTurn },
        { kind: "turn", turn: userTurn("u2", "ok, fix it") },
        { kind: "turn", turn: userTurn("u3", "and run the tests") },
        { kind: "runner", level: "info", text: "Done" },
      ],
      awaitingInput: false,
      pending: [],
      queuedInputs: [],
      closed: true,
    });

    const output = renderToString(createElement(App, { store, statusBar: false, onSubmit() {} }));

    expect(output).toBe(
      [
        "",
        "❯ why?",
        "",
        "and that is why the test fails.",
        "",
        "❯ ok, fix it",
        "",
        "❯ and run the tests",
        "",
        "ℹ Done",
      ].join("\n"),
    );
  });

  it("marks a cancelled turn as interrupted", () => {
    const store = new UiStore<UiState>({
      staticItems: [
        { kind: "turn", turn: userTurn("u1", "what next?") },
        { kind: "turn", turn: { id: "a1", owner: "agent", status: "cancelled", parts: [] } },
      ],
      awaitingInput: false,
      pending: [],
      queuedInputs: [],
    });

    const output = renderToString(createElement(App, { store, statusBar: false, onSubmit() {} }));

    expect(output).toContain("what next?\n\n(interrupted)");
  });

  it("says when a turn stopped at the output limit", () => {
    const store = new UiStore<UiState>({
      staticItems: [
        {
          kind: "turn",
          turn: {
            id: "a1",
            owner: "agent",
            status: "complete",
            reason: "length",
            parts: [textPart("a1-p", "Here is the start of")],
          },
        },
      ],
      awaitingInput: false,
      pending: [],
      queuedInputs: [],
    });

    const output = renderToString(createElement(App, { store, statusBar: false, onSubmit() {} }));

    expect(output).toContain("Here is the start of\n⚠ Stopped at the output token limit");
  });

  it("keeps the input line visible while the agent is busy and the chat is taking input", () => {
    const busy = (awaitingInput: boolean) =>
      new UiStore<UiState>({
        staticItems: [],
        liveTurn: { id: "a1", owner: "agent", status: "streaming", parts: [] },
        awaitingInput,
        pending: [{ ...userTurn("u2", "queued one"), status: "pending" }],
        queuedInputs: [],
      });
    const render = (store: UiStore<UiState>) =>
      renderToString(createElement(App, { store, statusBar: false, onSubmit() {} }));
    const inputLines = (output: string) =>
      output.split("\n").filter((line) => line.trimEnd() === "❯" || line.startsWith("❯  "));

    expect(inputLines(render(busy(true)))).toHaveLength(1);
    expect(inputLines(render(busy(false)))).toHaveLength(0);
  });

  it("lists the transcript's pending entries as queued rows", () => {
    const store = new UiStore<UiState>({
      staticItems: [],
      awaitingInput: true,
      pending: [
        { ...userTurn("u1", "also check the tests"), status: "pending" },
        {
          id: "c1",
          owner: "agent",
          status: "pending",
          parts: [{ id: "c1", type: "compaction", trigger: "manual", status: "pending" }],
        },
      ],
      queuedInputs: [],
    });

    const output = renderToString(createElement(App, { store, statusBar: false, onSubmit() {} }));

    expect(output).toContain("❯ also check the tests (queued)");
    expect(output).toContain("Compaction (queued)");
  });
});

describe("partitionTurns", () => {
  it("keeps a streaming turn live and commits it once finished", () => {
    const { feed } = createHarness();

    feed({ type: "turn:user", turn: userTurn("u1", "hi") });
    feed({ type: "turn:start", turnId: "t1" });
    feed({ type: "part:start", turnId: "t1", part: textPart("p1", "") });
    let result = feed({ type: "text:delta", turnId: "t1", partId: "p1", delta: "hello" });

    expect(result.commits).toEqual([]);
    expect(result.liveTurn?.id).toBe("t1");
    expect(result.liveTurn?.status).toBe("streaming");

    feed({ type: "part:end", turnId: "t1", partId: "p1" });
    result = feed({
      type: "turn:end",
      turnId: "t1",
      status: "complete",
      usage: { in: 10, out: 20, breakdown: [] },
    });

    expect(result.liveTurn).toBeUndefined();
    expect(result.commits).toHaveLength(1);
    const item = result.commits[0];
    if (item.kind === "turn") {
      expect(item.turn.status).toBe("complete");
      expect(item.turn.usage).toEqual({ in: 10, out: 20, breakdown: [] });
      expect(item.turn.parts[0]).toMatchObject({ type: "text", text: "hello" });
    } else {
      expect.fail("expected a turn item");
    }
  });

  it("commits a user turn immediately", () => {
    const { feed } = createHarness();

    const result = feed({ type: "turn:user", turn: userTurn("u1", "hi") });

    expect(result.liveTurn).toBeUndefined();
    expect(result.commits).toEqual([{ kind: "turn", turn: userTurn("u1", "hi") }]);
  });

  it("commits a cancelled turn with its partial content", () => {
    const { feed } = createHarness();

    feed({ type: "turn:start", turnId: "t1" });
    feed({ type: "part:start", turnId: "t1", part: textPart("p1", "") });
    feed({ type: "text:delta", turnId: "t1", partId: "p1", delta: "partial" });
    const result = feed({
      type: "turn:end",
      turnId: "t1",
      status: "cancelled",
      usage: { in: 1, out: 2, breakdown: [] },
    });

    expect(result.liveTurn).toBeUndefined();
    const item = result.commits[0];
    if (item.kind === "turn") {
      expect(item.turn.status).toBe("cancelled");
      expect(item.turn.parts[0]).toMatchObject({ type: "text", text: "partial" });
    } else {
      expect.fail("expected a turn item");
    }
  });

  it("never commits the same turn twice across later events", () => {
    const { feed } = createHarness();

    feed({ type: "turn:user", turn: userTurn("u1", "hi") });
    feed({
      type: "turn:end",
      turnId: "u1",
      status: "complete",
      usage: { in: 0, out: 0, breakdown: [] },
    });
    feed({ type: "turn:start", turnId: "t1" });
    feed({
      type: "turn:end",
      turnId: "t1",
      status: "complete",
      usage: { in: 1, out: 1, breakdown: [] },
    });
    feed({ type: "turn:start", turnId: "t2" });
    const result = feed({
      type: "turn:end",
      turnId: "t2",
      status: "complete",
      usage: { in: 1, out: 1, breakdown: [] },
    });

    expect(result.commits.map((item) => (item.kind === "turn" ? item.turn.id : ""))).toEqual([
      "t2",
    ]);
  });

  describe("while a turn streams", () => {
    const texts = (items: { kind: string; turn?: Turn }[]) =>
      items.map((item) =>
        item.turn?.parts.map((part) => (part.type === "text" ? part.text : part.type)),
      );

    it("commits each markdown block once the next one starts", () => {
      const { feed, text } = createHarness();
      feed({ type: "turn:start", turnId: "t1" });
      feed({ type: "part:start", turnId: "t1", part: textPart("p1", "") });

      let result = text("First paragraph.\n\n");
      expect(result.commits).toEqual([]);
      expect(result.liveContinues).toBe(false);

      result = text("Second");
      expect(texts(result.commits)).toEqual([["First paragraph.\n\n"]]);
      expect(result.commits[0]).toMatchObject({ continues: false });
      expect(texts([{ kind: "turn", turn: result.liveTurn }])).toEqual([["Second"]]);
      expect(result.liveContinues).toBe(true);

      result = text(" paragraph.\n\n- one\n");
      expect(texts(result.commits)).toEqual([["Second paragraph.\n\n"]]);
      expect(result.commits[0]).toMatchObject({ continues: true });

      result = text("- two\n");
      expect(result.commits).toEqual([]);
      expect(texts([{ kind: "turn", turn: result.liveTurn }])).toEqual([["- one\n- two\n"]]);
    });

    it("keeps an open code fence live across its blank lines", () => {
      const { feed, text } = createHarness();
      feed({ type: "turn:start", turnId: "t1" });
      feed({ type: "part:start", turnId: "t1", part: textPart("p1", "") });

      let result = text("Intro.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n");
      expect(texts(result.commits)).toEqual([["Intro.\n\n"]]);

      result = text("\nconst c = 3;\n```\n\nAfter");
      expect(texts(result.commits)).toEqual([
        ["```ts\nconst a = 1;\n\nconst b = 2;\n\nconst c = 3;\n```\n\n"],
      ]);
    });

    it("commits a settled part when the next part starts and holds a running action", () => {
      const { feed } = createHarness();
      feed({ type: "turn:start", turnId: "t1" });
      feed({ type: "part:start", turnId: "t1", part: { id: "th", type: "thinking" } });
      let result = feed({
        type: "part:start",
        turnId: "t1",
        part: {
          id: "act",
          type: "action",
          kind: "tool",
          status: "running",
          detail: { name: "calculator", parameters: {} },
        },
      });
      expect(texts(result.commits)).toEqual([["thinking"]]);

      result = feed({ type: "part:start", turnId: "t1", part: textPart("p1", "") });
      expect(result.commits).toEqual([]);
      expect(texts([{ kind: "turn", turn: result.liveTurn }])).toEqual([["action", ""]]);
    });

    it("commits only what is left when the turn finishes", () => {
      const { feed, text } = createHarness();
      feed({ type: "turn:start", turnId: "t1" });
      feed({ type: "part:start", turnId: "t1", part: textPart("p1", "") });
      text("First paragraph.\n\nSecond");

      const result = feed({
        type: "turn:end",
        turnId: "t1",
        status: "cancelled",
        usage: { in: 1, out: 2, breakdown: [] },
      });

      expect(texts(result.commits)).toEqual([["Second"]]);
      expect(result.commits[0]).toMatchObject({ continues: true, turn: { status: "cancelled" } });
      expect(result.liveTurn).toBeUndefined();
    });
  });
});
