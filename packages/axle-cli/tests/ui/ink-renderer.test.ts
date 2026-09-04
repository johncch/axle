import type { Turn, TurnEvent } from "@fifthrevision/axle/ui";
import { Transcript } from "@fifthrevision/axle/ui";
import { describe, expect, it } from "vitest";
import type { UiState } from "../../src/ui/ink/store.js";
import { partitionTurns, UiStore } from "../../src/ui/ink/store.js";

function textPart(id: string, text: string) {
  return { id, type: "text" as const, text };
}

function userTurn(id: string, text: string): Turn {
  return { id, owner: "user", status: "complete", parts: [textPart(`${id}-p`, text)] };
}

function createHarness() {
  const transcript = new Transcript();
  const committed = new Set<string>();
  const feed = (event: TurnEvent) => {
    transcript.apply(event);
    return partitionTurns(transcript.turns, committed);
  };
  return { feed };
}

describe("UiStore", () => {
  it("notifies subscribers and swaps state immutably", () => {
    const store = new UiStore<UiState>({
      staticItems: [],
      awaitingInput: false,
      queuedInputs: [],
    });
    const before = store.getSnapshot();
    let notified = 0;
    const unsubscribe = store.subscribe(() => notified++);

    store.update((state) => ({
      ...state,
      staticItems: [...state.staticItems, { kind: "host", level: "info", text: "hi" }],
    }));

    expect(notified).toBe(1);
    expect(store.getSnapshot()).not.toBe(before);
    expect(store.getSnapshot().staticItems).toHaveLength(1);

    unsubscribe();
    store.update((state) => state);
    expect(notified).toBe(1);
  });
});

describe("partitionTurns", () => {
  it("keeps a streaming turn live and commits it once finished", () => {
    const { feed } = createHarness();

    feed({ type: "turn:user", turn: userTurn("u1", "hi") });
    feed({ type: "turn:start", turnId: "t1" });
    feed({ type: "part:start", turnId: "t1", part: textPart("p1", "") });
    let result = feed({ type: "text:delta", turnId: "t1", partId: "p1", delta: "hello" });

    expect(result.newlyFinished).toEqual([]);
    expect(result.liveTurn?.id).toBe("t1");
    expect(result.liveTurn?.status).toBe("streaming");

    feed({ type: "part:end", turnId: "t1", partId: "p1" });
    result = feed({
      type: "turn:end",
      turnId: "t1",
      status: "complete",
      usage: { in: 10, out: 20 },
    });

    expect(result.liveTurn).toBeUndefined();
    expect(result.newlyFinished).toHaveLength(1);
    const item = result.newlyFinished[0];
    if (item.kind === "turn") {
      expect(item.turn.status).toBe("complete");
      expect(item.turn.usage).toEqual({ in: 10, out: 20 });
      expect(item.turn.parts[0]).toMatchObject({ type: "text", text: "hello" });
    } else {
      expect.fail("expected a turn item");
    }
  });

  it("commits a user turn immediately", () => {
    const { feed } = createHarness();

    const result = feed({ type: "turn:user", turn: userTurn("u1", "hi") });

    expect(result.liveTurn).toBeUndefined();
    expect(result.newlyFinished).toEqual([{ kind: "turn", turn: userTurn("u1", "hi") }]);
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
      usage: { in: 1, out: 2 },
    });

    expect(result.liveTurn).toBeUndefined();
    const item = result.newlyFinished[0];
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
    feed({ type: "turn:end", turnId: "u1", status: "complete", usage: { in: 0, out: 0 } });
    feed({ type: "turn:start", turnId: "t1" });
    feed({ type: "turn:end", turnId: "t1", status: "complete", usage: { in: 1, out: 1 } });
    feed({ type: "turn:start", turnId: "t2" });
    const result = feed({
      type: "turn:end",
      turnId: "t2",
      status: "complete",
      usage: { in: 1, out: 1 },
    });

    expect(result.newlyFinished.map((item) => (item.kind === "turn" ? item.turn.id : ""))).toEqual([
      "t2",
    ]);
  });
});
