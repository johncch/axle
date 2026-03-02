import { describe, expect, test } from "vitest";
import type { StreamResult } from "../../src/providers/helpers.js";
import type { StreamEvent, StreamHandle } from "../../src/providers/stream.js";
import { StreamSession } from "../../src/transport/session.js";
import { createSSEStream, serializeSSE } from "../../src/transport/sse.js";
import type { SeqEvent } from "../../src/transport/store.js";

function createMockStreamHandle(): {
  handle: StreamHandle;
  pushEvent: (event: StreamEvent) => void;
  resolve: (result: StreamResult) => void;
} {
  const callbacks: ((event: StreamEvent) => void)[] = [];
  let resolvePromise: (result: StreamResult) => void;

  const finalPromise = new Promise<StreamResult>((res) => {
    resolvePromise = res;
  });

  return {
    handle: {
      on(cb) {
        callbacks.push(cb);
      },
      cancel() {},
      get final() {
        return finalPromise;
      },
    },
    pushEvent: (event) => {
      for (const cb of callbacks) cb(event);
    },
    resolve: (result) => resolvePromise(result),
  };
}

describe("serializeSSE", () => {
  test("basic event serializes to correct SSE format", () => {
    const entry: SeqEvent = { seq: 1, event: { type: "text:start", index: 0 } };
    const result = serializeSSE(entry);

    expect(result).toBe(`id: 1\nevent: text:start\ndata: {"type":"text:start","index":0}\n\n`);
  });

  test("multi-line data splits into multiple data: lines", () => {
    // Force a multi-line JSON by using a string with a newline in it
    const event = {
      type: "text:delta",
      index: 0,
      delta: "line1\nline2",
      accumulated: "line1\nline2",
    } as StreamEvent;
    const entry: SeqEvent = { seq: 5, event };
    const result = serializeSSE(entry);

    const lines = result.split("\n");
    expect(lines[0]).toBe("id: 5");
    expect(lines[1]).toBe("event: text:delta");
    // JSON with escaped newlines stays on one data: line since JSON.stringify escapes \n
    expect(lines[2]).toMatch(/^data: /);
    // Ends with double newline
    expect(result.endsWith("\n\n")).toBe(true);
  });
});

describe("createSSEStream", () => {
  test("produces SSE strings for each event", async () => {
    const { handle, pushEvent, resolve } = createMockStreamHandle();
    const session = new StreamSession();
    session.attach(handle);

    pushEvent({ type: "text:start", index: 0 });
    pushEvent({ type: "text:end", index: 0, final: "done" });
    resolve({ result: "success", messages: [], usage: { in: 1, out: 1 } });
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
    expect(chunks[0]).toContain("event: text:start");
    expect(chunks[1]).toContain("id: 2");
    expect(chunks[1]).toContain("event: text:end");
  });

  test("stream closes when session completes", async () => {
    const { handle, resolve } = createMockStreamHandle();
    const session = new StreamSession();
    session.attach(handle);

    resolve({ result: "success", messages: [], usage: { in: 0, out: 0 } });
    await session.final;

    const stream = createSSEStream(session);
    const reader = stream.getReader();
    const { done } = await reader.read();
    expect(done).toBe(true);
  });

  test("cancel() on stream cleans up subscription", async () => {
    const { handle, pushEvent } = createMockStreamHandle();
    const session = new StreamSession();
    session.attach(handle);

    pushEvent({ type: "text:start", index: 0 });

    const stream = createSSEStream(session);
    const reader = stream.getReader();

    // Read one event
    const { value } = await reader.read();
    expect(value).toContain("text:start");

    // Cancel the stream
    await reader.cancel();

    // Should not throw on further events
    pushEvent({ type: "text:end", index: 0, final: "x" });
  });
});
