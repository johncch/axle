import { describe, expect, test } from "vitest";
import { Channel } from "../../src/transport/channel.js";

describe("Channel", () => {
  test("push before consume — values queued and delivered in order", async () => {
    const ch = new Channel<number>();
    ch.push(1);
    ch.push(2);
    ch.push(3);
    ch.close();

    const collected: number[] = [];
    for await (const v of ch) collected.push(v);
    expect(collected).toEqual([1, 2, 3]);
  });

  test("consume before push — consumer blocks until push delivers", async () => {
    const ch = new Channel<string>();
    const result: string[] = [];

    const consumer = (async () => {
      for await (const v of ch) result.push(v);
    })();

    // Let consumer start waiting
    await Promise.resolve();

    ch.push("a");
    ch.push("b");
    ch.close();

    await consumer;
    expect(result).toEqual(["a", "b"]);
  });

  test("close signals done to waiting consumer", async () => {
    const ch = new Channel<number>();

    const iter = ch[Symbol.asyncIterator]();
    const pending = iter.next();

    ch.close();

    const result = await pending;
    expect(result.done).toBe(true);
  });

  test("close after queued values — drain queue then done", async () => {
    const ch = new Channel<number>();
    ch.push(10);
    ch.push(20);
    ch.close();

    const iter = ch[Symbol.asyncIterator]();
    expect(await iter.next()).toEqual({ value: 10, done: false });
    expect(await iter.next()).toEqual({ value: 20, done: false });
    expect((await iter.next()).done).toBe(true);
  });

  test("close is idempotent", async () => {
    const ch = new Channel<number>();
    ch.push(1);
    ch.close();
    ch.close();
    ch.close();

    const collected: number[] = [];
    for await (const v of ch) collected.push(v);
    expect(collected).toEqual([1]);
  });

  test("push after close is a no-op", async () => {
    const ch = new Channel<number>();
    ch.push(1);
    ch.close();
    ch.push(2); // should be ignored

    const collected: number[] = [];
    for await (const v of ch) collected.push(v);
    expect(collected).toEqual([1]);
  });

  test("break from for-await triggers return() and cleanup", async () => {
    const ch = new Channel<number>();
    ch.push(1);
    ch.push(2);
    ch.push(3);

    const collected: number[] = [];
    for await (const v of ch) {
      collected.push(v);
      if (v === 2) break;
    }
    expect(collected).toEqual([1, 2]);

    // Channel should be closed after break
    ch.push(99); // no-op since return() closed it
    const iter = ch[Symbol.asyncIterator]();
    expect((await iter.next()).done).toBe(true);
  });

  test("empty channel — close immediately yields done", async () => {
    const ch = new Channel<number>();
    ch.close();

    const collected: number[] = [];
    for await (const v of ch) collected.push(v);
    expect(collected).toEqual([]);
  });
});
