import type { Turn, TurnEvent } from "@fifthrevision/axle/ui";
import { Transcript } from "@fifthrevision/axle/ui";
import { describe, expect, it } from "vitest";
import { PlainRenderer } from "../../src/ui/plain.js";

function createHarness() {
  const output: string[] = [];
  const renderer = new PlainRenderer({ write: (text) => output.push(text) });
  const transcript = new Transcript();
  const feed = (event: TurnEvent) => {
    transcript.apply(event);
    renderer.onEvent(event, transcript);
  };
  return { renderer, transcript, feed, text: () => output.join("") };
}

const toolPart = {
  id: "p2",
  type: "action" as const,
  kind: "tool" as const,
  status: "pending" as const,
  detail: { name: "calculator", parameters: {} },
};

describe("PlainRenderer", () => {
  it("streams text deltas and ends the line on part:end", () => {
    const { feed, text } = createHarness();

    feed({ type: "turn:start", turnId: "t1" });
    feed({ type: "part:start", turnId: "t1", part: { id: "p1", type: "text", text: "" } });
    feed({ type: "text:delta", turnId: "t1", partId: "p1", delta: "Hello " });
    feed({ type: "text:delta", turnId: "t1", partId: "p1", delta: "world" });
    feed({ type: "part:end", turnId: "t1", partId: "p1" });

    expect(text()).toBe("Hello world\n");
  });

  it("renders a settled action with args and duration", () => {
    const { feed, text } = createHarness();

    feed({ type: "turn:start", turnId: "t1" });
    feed({
      type: "part:start",
      turnId: "t1",
      part: { ...toolPart, detail: { name: "calculator", parameters: { a: 2, b: 2 } } },
    });
    feed({ type: "action:running", turnId: "t1", partId: "p2", parameters: { a: 2, b: 2 } });
    feed({
      type: "action:complete",
      turnId: "t1",
      partId: "p2",
      result: { type: "success", content: "4" },
      timing: { start: "2026-09-03T00:00:00.000Z", end: "2026-09-03T00:00:00.430Z" },
    });

    expect(text()).toBe('✔ Calculator {"a":2,"b":2} (430ms)\n');
  });

  it("renders a failed action with the error glyph", () => {
    const { feed, text } = createHarness();

    feed({ type: "turn:start", turnId: "t1" });
    feed({ type: "part:start", turnId: "t1", part: toolPart });
    feed({
      type: "action:error",
      turnId: "t1",
      partId: "p2",
      error: { type: "tool", message: "division by zero" },
    });

    expect(text()).toBe("✖ Calculator\n");
  });

  it("renders host lines with the consola gutter", () => {
    const { renderer, text } = createHarness();

    renderer.info("Session abc");
    renderer.success("Done in 1.9s");
    renderer.warn("careful");
    renderer.error("boom");

    expect(text()).toBe("ℹ Session abc\n✔ Done in 1.9s\n⚠ careful\n✖ boom\n");
  });

  it("breaks an in-progress delta line before a host line", () => {
    const { renderer, feed, text } = createHarness();

    feed({ type: "turn:start", turnId: "t1" });
    feed({ type: "part:start", turnId: "t1", part: { id: "p1", type: "text", text: "" } });
    feed({ type: "text:delta", turnId: "t1", partId: "p1", delta: "partial" });
    renderer.info("host message");

    expect(text()).toBe("partial\nℹ host message\n");
  });

  it("renders top-level error events", () => {
    const { feed, text } = createHarness();

    feed({ type: "error", error: { type: "model", message: "boom" } });

    expect(text()).toBe("✖ boom\n");
  });

  it("replays prior turns in the shared dialect", () => {
    const { renderer, text } = createHarness();
    const turns: Turn[] = [
      {
        id: "u1",
        owner: "user",
        status: "complete",
        parts: [{ id: "p1", type: "text", text: "Add 2 and 2\n" }],
      },
      {
        id: "a1",
        owner: "agent",
        status: "complete",
        parts: [
          {
            ...toolPart,
            status: "complete",
            timing: { start: "2026-09-03T00:00:00.000Z", end: "2026-09-03T00:00:01.200Z" },
          },
          { id: "p3", type: "text", text: "The answer is 4." },
        ],
      },
    ];

    renderer.renderPriorTurns(turns);

    expect(text()).toBe("❯ Add 2 and 2\n✔ Calculator (1.2s)\nThe answer is 4.\n");
  });

  it("close terminates a dangling line exactly once", () => {
    const { renderer, feed, text } = createHarness();

    feed({ type: "turn:start", turnId: "t1" });
    feed({ type: "part:start", turnId: "t1", part: { id: "p1", type: "text", text: "" } });
    feed({ type: "text:delta", turnId: "t1", partId: "p1", delta: "dangling" });
    renderer.close();
    renderer.close();

    expect(text()).toBe("dangling\n");
  });
});
