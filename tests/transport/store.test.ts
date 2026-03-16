import { describe, expect, test } from "vitest";
import type { StreamResult } from "../../src/providers/helpers.js";
import type { AgentEvent } from "../../src/turns/events.js";
import type { SeqEvent } from "../../src/transport/store.js";
import { MemorySessionStore } from "../../src/transport/store.js";

function makeEvent(seq: number): SeqEvent {
  return {
    seq,
    event: { type: "part:start", turnId: "t1", part: { id: `p${seq}`, type: "text", text: "" } } as AgentEvent,
  };
}

function makeResult(): StreamResult {
  return { result: "success", messages: [], usage: { in: 10, out: 20 } };
}

describe("MemorySessionStore", () => {
  test("read from empty session returns []", () => {
    const store = new MemorySessionStore();
    expect(store.read("unknown")).toEqual([]);
  });

  test("append then read returns entries in order", () => {
    const store = new MemorySessionStore();
    store.append("s1", makeEvent(1));
    store.append("s1", makeEvent(2));
    store.append("s1", makeEvent(3));

    const events = store.read("s1");
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  test("read(id, afterSeq) filters correctly using >", () => {
    const store = new MemorySessionStore();
    store.append("s1", makeEvent(1));
    store.append("s1", makeEvent(2));
    store.append("s1", makeEvent(3));
    store.append("s1", makeEvent(4));

    expect(store.read("s1", 2).map((e) => e.seq)).toEqual([3, 4]);
    expect(store.read("s1", 0).map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(store.read("s1", 4)).toEqual([]);
  });

  test("read returns copies to prevent mutation", () => {
    const store = new MemorySessionStore();
    store.append("s1", makeEvent(1));

    const a = store.read("s1");
    const b = store.read("s1");
    expect(a).toEqual(b);
    expect(a[0]).not.toBe(b[0]);
  });

  test("getResult returns null for unknown session", () => {
    const store = new MemorySessionStore();
    expect(store.getResult("nope")).toBeNull();
  });

  test("setResult + getResult roundtrip", () => {
    const store = new MemorySessionStore();
    const result = makeResult();
    store.setResult("s1", result);
    expect(store.getResult("s1")).toEqual(result);
  });

  test("delete removes events and result", () => {
    const store = new MemorySessionStore();
    store.append("s1", makeEvent(1));
    store.setResult("s1", makeResult());

    store.delete("s1");
    expect(store.read("s1")).toEqual([]);
    expect(store.getResult("s1")).toBeNull();
  });

  test("different sessions have independent buffers", () => {
    const store = new MemorySessionStore();
    store.append("a", makeEvent(1));
    store.append("b", makeEvent(10));

    expect(store.read("a").map((e) => e.seq)).toEqual([1]);
    expect(store.read("b").map((e) => e.seq)).toEqual([10]);
  });
});
