import { describe, expect, test } from "vitest";
import type { AgentEvent } from "../../src/turns/events.js";
import { StreamSession } from "../../src/transport/session.js";
import { MemorySessionStore } from "../../src/transport/store.js";

function textDelta(turnId: string, partId: string, delta: string): AgentEvent {
  return { type: "text:delta", turnId, partId, delta };
}

function partStart(turnId: string): AgentEvent {
  return { type: "part:start", turnId, part: { id: "p1", type: "text", text: "" } };
}

function partEnd(turnId: string, partId: string): AgentEvent {
  return { type: "part:end", turnId, partId };
}

function turnStart(turnId: string): AgentEvent {
  return { type: "turn:start", turnId };
}

function turnEnd(turnId: string): AgentEvent {
  return { type: "turn:end", turnId, usage: { in: 0, out: 0 } };
}

describe("StreamSession", () => {
  describe("push() and close()", () => {
    test("push() assigns incrementing seq and delivers to subscribers", async () => {
      const session = new StreamSession();

      const collected: number[] = [];
      const consumer = (async () => {
        for await (const { seq } of session.subscribe()) collected.push(seq);
      })();

      await Promise.resolve();
      session.push(partStart("t1"));
      session.push(textDelta("t1", "p1", "hi"));
      session.push(partEnd("t1", "p1"));
      session.close();

      await consumer;
      expect(collected).toEqual([1, 2, 3]);
    });

    test("push() sets status to running on first call", () => {
      const session = new StreamSession();
      expect(session.status).toBe("idle");

      session.push(partStart("t1"));
      expect(session.status).toBe("running");
    });

    test("initial status is idle", () => {
      const session = new StreamSession();
      expect(session.status).toBe("idle");
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
      session.push(partStart("t1"));
      session.close();

      await Promise.all([consumerA, consumerB]);
      expect(session.status).toBe("completed");
      expect(a).toEqual([1]);
      expect(b).toEqual([1]);
    });

    test("close() resolves final promise", async () => {
      const session = new StreamSession();
      session.push(partStart("t1"));
      session.close();

      const result = await session.final;
      expect(result.result).toBe("success");
    });

    test("push() after close() is a no-op", async () => {
      const store = new MemorySessionStore();
      const session = new StreamSession(store);

      session.push(partStart("t1"));
      session.close();

      session.push(partEnd("t1", "p1"));

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
      session.push(turnStart("t1"));
      session.push(partStart("t1"));
      session.push(textDelta("t1", "p1", "hello"));
      session.push(partEnd("t1", "p1"));
      session.push(turnEnd("t1"));
      session.close();

      await consumer;
      expect(collected).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe("subscribe", () => {
    test("subscribe before events — receives events as they arrive", async () => {
      const session = new StreamSession();

      const collected: number[] = [];
      const consumer = (async () => {
        for await (const { seq } of session.subscribe()) collected.push(seq);
      })();

      await Promise.resolve();
      session.push(partStart("t1"));
      session.push(textDelta("t1", "p1", "hi"));
      session.close();

      await consumer;
      expect(collected).toEqual([1, 2]);
    });

    test("events delivered in seq order, seq starts at 1", async () => {
      const session = new StreamSession();

      session.push(turnStart("t1"));
      session.push(partStart("t1"));
      session.push(partEnd("t1", "p1"));
      session.close();

      const events: number[] = [];
      for await (const { seq } of session.subscribe()) events.push(seq);
      expect(events).toEqual([1, 2, 3]);
    });

    test("multiple concurrent subscribers each receive all events", async () => {
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
      session.push(partStart("t1"));
      session.push(partEnd("t1", "p1"));
      session.close();

      await Promise.all([consumerA, consumerB]);
      expect(a).toEqual([1, 2]);
      expect(b).toEqual([1, 2]);
    });

    test("subscribe with afterSeq skips already-seen events", async () => {
      const store = new MemorySessionStore();
      const session = new StreamSession(store);

      session.push(partStart("t1"));
      session.push(textDelta("t1", "p1", "a"));
      session.push(partEnd("t1", "p1"));
      session.close();

      await session.final;

      const events: number[] = [];
      for await (const { seq } of session.subscribe(2)) events.push(seq);
      expect(events).toEqual([3]);
    });

    test("subscribe after stream completed — replays all then closes", async () => {
      const session = new StreamSession();

      session.push(partStart("t1"));
      session.push(partEnd("t1", "p1"));
      session.close();
      await session.final;

      const events: number[] = [];
      for await (const { seq } of session.subscribe()) events.push(seq);
      expect(events).toEqual([1, 2]);
    });

    test("breaking from subscribe removes channel from live set", async () => {
      const session = new StreamSession();

      const collected: number[] = [];
      const consumer = (async () => {
        for await (const { seq } of session.subscribe()) {
          collected.push(seq);
          if (seq === 2) break;
        }
      })();

      await Promise.resolve();
      session.push(partStart("t1"));
      session.push(textDelta("t1", "p1", "a"));

      await consumer;
      expect(collected).toEqual([1, 2]);

      // Further events and completion should not throw
      session.push(partEnd("t1", "p1"));
      session.close();
      await session.final;
    });

    test("subscribe to idle session — receives nothing until push", async () => {
      const session = new StreamSession();

      const collected: number[] = [];
      const consumer = (async () => {
        for await (const { seq } of session.subscribe()) collected.push(seq);
      })();

      // No events yet
      await Promise.resolve();
      expect(collected).toEqual([]);

      session.push(partStart("t1"));
      session.close();

      await consumer;
      expect(collected).toEqual([1]);
    });
  });
});
