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

  it("renders a running action as a one-line marker with its name", () => {
    const { feed, text } = createHarness();

    feed({ type: "turn:start", turnId: "t1" });
    feed({ type: "part:start", turnId: "t1", part: toolPart });
    feed({ type: "action:running", turnId: "t1", partId: "p2", parameters: { a: 2 } });

    expect(text()).toBe("[tool] calculator\n");
  });

  it("breaks an in-progress delta line before a host line", () => {
    const { renderer, feed, text } = createHarness();

    feed({ type: "turn:start", turnId: "t1" });
    feed({ type: "part:start", turnId: "t1", part: { id: "p1", type: "text", text: "" } });
    feed({ type: "text:delta", turnId: "t1", partId: "p1", delta: "partial" });
    renderer.info("host message");

    expect(text()).toBe("partial\nhost message\n");
  });

  it("renders top-level error events", () => {
    const { feed, text } = createHarness();

    feed({ type: "error", error: { type: "model", message: "boom" } });

    expect(text()).toBe("Error: boom\n");
  });

  it("renders action errors with the message", () => {
    const { feed, text } = createHarness();

    feed({ type: "turn:start", turnId: "t1" });
    feed({ type: "part:start", turnId: "t1", part: toolPart });
    feed({
      type: "action:error",
      turnId: "t1",
      partId: "p2",
      error: { type: "tool", message: "division by zero" },
    });

    expect(text()).toBe("[error] division by zero\n");
  });

  it("replays prior turns with owner prefixes and action markers", () => {
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
          { ...toolPart, status: "complete" },
          { id: "p3", type: "text", text: "The answer is 4." },
        ],
      },
    ];

    renderer.renderPriorTurns(turns);

    expect(text()).toBe("> Add 2 and 2\n[tool] calculator\nThe answer is 4.\n");
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
