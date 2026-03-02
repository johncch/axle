import { describe, expect, test } from "vitest";
import type { StreamResult } from "../../src/providers/helpers.js";
import type { StreamEvent, StreamHandle } from "../../src/providers/stream.js";
import { StreamSession } from "../../src/transport/session.js";
import { MemorySessionStore } from "../../src/transport/store.js";

// --- Mock helper ---

function createMockStreamHandle(): {
  handle: StreamHandle;
  pushEvent: (event: StreamEvent) => void;
  resolve: (result: StreamResult) => void;
  reject: (error: unknown) => void;
} {
  const callbacks: ((event: StreamEvent) => void)[] = [];
  let resolvePromise: (result: StreamResult) => void;
  let rejectPromise: (error: unknown) => void;

  const finalPromise = new Promise<StreamResult>((res, rej) => {
    resolvePromise = res;
    rejectPromise = rej;
  });

  const handle: StreamHandle = {
    on(cb) {
      callbacks.push(cb);
    },
    cancel() {},
    get final() {
      return finalPromise;
    },
  };

  return {
    handle,
    pushEvent: (event: StreamEvent) => {
      for (const cb of callbacks) cb(event);
    },
    resolve: (result: StreamResult) => resolvePromise(result),
    reject: (error: unknown) => rejectPromise(error),
  };
}

function successResult(): StreamResult {
  return { result: "success", messages: [], usage: { in: 1, out: 2 } };
}

describe("StreamSession", () => {
  test("initial status is idle, becomes running after attach", () => {
    const { handle } = createMockStreamHandle();
    const session = new StreamSession();
    expect(session.status).toBe("idle");

    session.attach(handle);
    expect(session.status).toBe("running");
  });

  test("status becomes completed on stream success", async () => {
    const { handle, resolve } = createMockStreamHandle();
    const session = new StreamSession();
    session.attach(handle);

    resolve(successResult());
    await session.final;
    expect(session.status).toBe("completed");
  });

  test("status becomes error on stream error result", async () => {
    const { handle, resolve } = createMockStreamHandle();
    const session = new StreamSession();
    session.attach(handle);

    resolve({
      result: "error",
      messages: [],
      error: { type: "model", error: { type: "error", error: { type: "test", message: "fail" } } },
      usage: { in: 0, out: 0 },
    });
    await session.final;
    expect(session.status).toBe("error");
  });

  test("attach() throws if called twice", () => {
    const { handle } = createMockStreamHandle();
    const mock2 = createMockStreamHandle();
    const session = new StreamSession();
    session.attach(handle);
    expect(() => session.attach(mock2.handle)).toThrow("only be attached when idle");
  });

  test("final resolves with the stream result", async () => {
    const { handle, resolve } = createMockStreamHandle();
    const session = new StreamSession();
    session.attach(handle);

    const expected = successResult();
    resolve(expected);
    const result = await session.final;
    expect(result).toEqual(expected);
  });

  test("final resolves with wrapped error if handle rejects", async () => {
    const { handle, reject } = createMockStreamHandle();
    const session = new StreamSession();
    session.attach(handle);

    reject(new Error("connection lost"));
    const result = await session.final;
    expect(result.result).toBe("error");
    if (result.result === "error") {
      expect(result.error.type).toBe("model");
    }
  });

  test("subscribe before events — receives events as they arrive", async () => {
    const { handle, pushEvent, resolve } = createMockStreamHandle();
    const session = new StreamSession();
    session.attach(handle);

    const collected: number[] = [];
    const consumer = (async () => {
      for await (const { seq } of session.subscribe()) collected.push(seq);
    })();

    await Promise.resolve();
    pushEvent({ type: "text:start", index: 0 });
    pushEvent({ type: "text:delta", index: 0, delta: "hi", accumulated: "hi" });
    resolve(successResult());

    await consumer;
    expect(collected).toEqual([1, 2]);
  });

  test("events delivered in seq order, seq starts at 1", async () => {
    const { handle, pushEvent, resolve } = createMockStreamHandle();
    const session = new StreamSession();
    session.attach(handle);

    pushEvent({ type: "turn:start", id: "t1", model: "m" });
    pushEvent({ type: "text:start", index: 0 });
    pushEvent({ type: "text:end", index: 0, final: "done" });
    resolve(successResult());

    await session.final;

    const events: number[] = [];
    for await (const { seq } of session.subscribe()) events.push(seq);
    expect(events).toEqual([1, 2, 3]);
  });

  test("multiple concurrent subscribers each receive all events", async () => {
    const { handle, pushEvent, resolve } = createMockStreamHandle();
    const session = new StreamSession();
    session.attach(handle);

    const a: number[] = [];
    const b: number[] = [];

    const consumerA = (async () => {
      for await (const { seq } of session.subscribe()) a.push(seq);
    })();
    const consumerB = (async () => {
      for await (const { seq } of session.subscribe()) b.push(seq);
    })();

    await Promise.resolve();
    pushEvent({ type: "text:start", index: 0 });
    pushEvent({ type: "text:end", index: 0, final: "x" });
    resolve(successResult());

    await Promise.all([consumerA, consumerB]);
    expect(a).toEqual([1, 2]);
    expect(b).toEqual([1, 2]);
  });

  test("subscribe with afterSeq skips already-seen events", async () => {
    const { handle, pushEvent, resolve } = createMockStreamHandle();
    const store = new MemorySessionStore();
    const session = new StreamSession(store);
    session.attach(handle);

    pushEvent({ type: "text:start", index: 0 });
    pushEvent({ type: "text:delta", index: 0, delta: "a", accumulated: "a" });
    pushEvent({ type: "text:end", index: 0, final: "a" });
    resolve(successResult());

    await session.final;

    const events: number[] = [];
    for await (const { seq } of session.subscribe(2)) events.push(seq);
    expect(events).toEqual([3]);
  });

  test("subscribe after stream completed — replays all then closes", async () => {
    const { handle, pushEvent, resolve } = createMockStreamHandle();
    const session = new StreamSession();
    session.attach(handle);

    pushEvent({ type: "text:start", index: 0 });
    pushEvent({ type: "text:end", index: 0, final: "done" });
    resolve(successResult());
    await session.final;

    const events: number[] = [];
    for await (const { seq } of session.subscribe()) events.push(seq);
    expect(events).toEqual([1, 2]);
  });

  test("breaking from subscribe removes channel from live set", async () => {
    const { handle, pushEvent, resolve } = createMockStreamHandle();
    const session = new StreamSession();
    session.attach(handle);

    const collected: number[] = [];
    const consumer = (async () => {
      for await (const { seq } of session.subscribe()) {
        collected.push(seq);
        if (seq === 2) break;
      }
    })();

    await Promise.resolve();
    pushEvent({ type: "text:start", index: 0 });
    pushEvent({ type: "text:delta", index: 0, delta: "a", accumulated: "a" });

    await consumer;
    expect(collected).toEqual([1, 2]);

    // Further events and completion should not throw
    pushEvent({ type: "text:end", index: 0, final: "a" });
    resolve(successResult());
    await session.final;
  });

  test("subscribe to idle session — receives nothing until attach + events", async () => {
    const { handle, pushEvent, resolve } = createMockStreamHandle();
    const session = new StreamSession();

    const collected: number[] = [];
    const consumer = (async () => {
      for await (const { seq } of session.subscribe()) collected.push(seq);
    })();

    // No events yet
    await Promise.resolve();
    expect(collected).toEqual([]);

    session.attach(handle);
    pushEvent({ type: "text:start", index: 0 });
    resolve(successResult());

    await consumer;
    expect(collected).toEqual([1]);
  });

  describe("push() and close()", () => {
    test("push() assigns incrementing seq and delivers to subscribers", async () => {
      const session = new StreamSession();

      const collected: number[] = [];
      const consumer = (async () => {
        for await (const { seq } of session.subscribe()) collected.push(seq);
      })();

      await Promise.resolve();
      session.push({ type: "text:start", index: 0 });
      session.push({ type: "text:delta", index: 0, delta: "hi", accumulated: "hi" });
      session.push({ type: "text:end", index: 0, final: "hi" });
      session.close();

      await consumer;
      expect(collected).toEqual([1, 2, 3]);
    });

    test("push() sets status to running on first call", () => {
      const session = new StreamSession();
      expect(session.status).toBe("idle");

      session.push({ type: "text:start", index: 0 });
      expect(session.status).toBe("running");
    });

    test("close() sets status to completed and closes all subscriber channels", async () => {
      const session = new StreamSession();

      const a: number[] = [];
      const b: number[] = [];
      const consumerA = (async () => {
        for await (const { seq } of session.subscribe()) a.push(seq);
      })();
      const consumerB = (async () => {
        for await (const { seq } of session.subscribe()) b.push(seq);
      })();

      await Promise.resolve();
      session.push({ type: "text:start", index: 0 });
      session.close();

      await Promise.all([consumerA, consumerB]);
      expect(session.status).toBe("completed");
      expect(a).toEqual([1]);
      expect(b).toEqual([1]);
    });

    test("close() resolves final promise", async () => {
      const session = new StreamSession();
      session.push({ type: "text:start", index: 0 });
      session.close();

      const result = await session.final;
      expect(result.result).toBe("success");
    });

    test("push() after close() is a no-op", async () => {
      const store = new MemorySessionStore();
      const session = new StreamSession(store);

      session.push({ type: "text:start", index: 0 });
      session.close();

      session.push({ type: "text:end", index: 0, final: "late" });

      const events: number[] = [];
      for await (const { seq } of session.subscribe()) events.push(seq);
      expect(events).toEqual([1]);
    });

    test("multiple pushes then close — subscriber receives all then exits", async () => {
      const session = new StreamSession();

      const collected: number[] = [];
      const consumer = (async () => {
        for await (const { seq } of session.subscribe()) collected.push(seq);
      })();

      await Promise.resolve();
      session.push({ type: "turn:start", id: "t1", model: "m" });
      session.push({ type: "text:start", index: 0 });
      session.push({ type: "text:delta", index: 0, delta: "hello", accumulated: "hello" });
      session.push({ type: "text:end", index: 0, final: "hello" });
      session.push({
        type: "turn:complete",
        message: {
          role: "assistant",
          id: "a1",
          content: [{ type: "text", text: "hello" }],
        },
      });
      session.close();

      await consumer;
      expect(collected).toEqual([1, 2, 3, 4, 5]);
    });

    test("attach() throws if session is not idle (already pushed)", () => {
      const { handle } = createMockStreamHandle();
      const session = new StreamSession();
      session.push({ type: "text:start", index: 0 });
      expect(() => session.attach(handle)).toThrow("only be attached when idle");
    });
  });
});
