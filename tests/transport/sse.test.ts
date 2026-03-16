import { describe, expect, test } from "vitest";
import type { AgentEvent } from "../../src/turns/events.js";
import { StreamSession } from "../../src/transport/session.js";
import { createSSEStream, serializeSSE } from "../../src/transport/sse.js";
import type { SeqEvent } from "../../src/transport/store.js";

describe("serializeSSE", () => {
  test("basic event serializes to correct SSE format", () => {
    const entry: SeqEvent = {
      seq: 1,
      event: { type: "part:start", turnId: "t1", part: { id: "p1", type: "text", text: "" } },
    };
    const result = serializeSSE(entry);

    expect(result).toContain("id: 1");
    expect(result).toContain("event: part:start");
    expect(result).toContain("data: ");
    expect(result.endsWith("\n\n")).toBe(true);
  });

  test("multi-line data splits into multiple data: lines", () => {
    const event: AgentEvent = {
      type: "text:delta",
      turnId: "t1",
      partId: "p1",
      delta: "line1\nline2",
    };
    const entry: SeqEvent = { seq: 5, event };
    const result = serializeSSE(entry);

    const lines = result.split("\n");
    expect(lines[0]).toBe("id: 5");
    expect(lines[1]).toBe("event: text:delta");
    expect(lines[2]).toMatch(/^data: /);
    expect(result.endsWith("\n\n")).toBe(true);
  });
});

describe("createSSEStream", () => {
  test("produces SSE strings for each event", async () => {
    const session = new StreamSession();

    session.push({ type: "part:start", turnId: "t1", part: { id: "p1", type: "text", text: "" } });
    session.push({ type: "part:end", turnId: "t1", partId: "p1" });
    session.close();
    await session.final;

    const stream = createSSEStream(session);
    const reader = stream.getReader();
    const chunks: string[] = [];

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain("id: 1");
    expect(chunks[0]).toContain("event: part:start");
    expect(chunks[1]).toContain("id: 2");
    expect(chunks[1]).toContain("event: part:end");
  });

  test("stream closes when session completes", async () => {
    const session = new StreamSession();
    session.close();
    await session.final;

    const stream = createSSEStream(session);
    const reader = stream.getReader();
    const { done } = await reader.read();
    expect(done).toBe(true);
  });

  test("cancel() on stream cleans up subscription", async () => {
    const session = new StreamSession();

    session.push({ type: "part:start", turnId: "t1", part: { id: "p1", type: "text", text: "" } });

    const stream = createSSEStream(session);
    const reader = stream.getReader();

    const { value } = await reader.read();
    expect(value).toContain("part:start");

    await reader.cancel();

    // Should not throw on further events
    session.push({ type: "part:end", turnId: "t1", partId: "p1" });
  });
});
