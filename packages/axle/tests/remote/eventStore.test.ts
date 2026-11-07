import { describe, expect, test } from "vitest";
import { Agent, type AgentStatus } from "../../src/core/agent/index.js";
import { InMemoryEventStore, type StoredEvent } from "../../src/remote/eventStore.js";
import { isStateEvent } from "../../src/remote/protocol.js";
import { parseSse, toEventStreamResponse, type SseMessage } from "../../src/remote/sse.js";
import type { TurnEvent } from "../../src/turns/events.js";
import { Transcript } from "../../src/turns/transcript.js";
import { textProvider, waitFor } from "./helpers.js";

type HostEvent = { type: "run:start"; id: string };

function collect<T extends { type: string }>(store: InMemoryEventStore<T>, after?: string) {
  const controller = new AbortController();
  const { state, items } = store.subscribe(controller.signal, after);
  const seen: StoredEvent<T>[] = [];
  const statuses: AgentStatus[] = [];
  const done = (async () => {
    for await (const item of items) {
      if (isStateEvent(item)) statuses.push(item.status);
      else seen.push(item);
    }
  })();
  return { opened: state.status, seen, statuses, stop: () => controller.abort(), done };
}

function seqs(entries: { cursor: string }[]): number[] {
  return entries.map((entry) => Number(entry.cursor.split("-")[1]));
}

describe("InMemoryEventStore", () => {
  test("stamps agent and host events in order and replays everything to a late subscriber", async () => {
    const agent = new Agent({ provider: textProvider(["one", "two"]), model: "mock" });
    const store = new InMemoryEventStore<HostEvent>(agent);
    store.push({ type: "run:start", id: "cycle-1" });
    await agent.send("first").final;
    const countBefore = Number(store.lastCursor.split("-")[1]);

    const late = collect(store);
    await agent.send("second").final;
    await waitFor(() => seqs(late.seen).at(-1) === Number(store.lastCursor.split("-")[1]));
    late.stop();
    await late.done;

    expect(countBefore).toBeGreaterThan(1);
    expect(late.seen[0]).toMatchObject({
      type: "run:start",
      id: "cycle-1",
      cursor: `${store.id}-1`,
    });
    expect(seqs(late.seen)).toEqual(late.seen.map((_, i) => i + 1));
    expect(late.seen.filter((entry) => entry.type === "turn:end")).toHaveLength(2);
  });

  test("a subscriber with an owned cursor gets only what came after, once, across the live boundary", async () => {
    const agent = new Agent({ provider: textProvider(["one", "two", "three"]), model: "mock" });
    const store = new InMemoryEventStore(agent);
    await agent.send("first").final;
    const cursor = store.lastCursor;

    expect(store.owns(cursor)).toBe(true);
    const resumed = collect(store, cursor);
    agent.send("second");
    await agent.send("third").final;
    await waitFor(() => resumed.seen.filter((entry) => entry.type === "turn:end").length === 2);
    resumed.stop();
    await resumed.done;

    const after = Number(cursor.split("-")[1]);
    expect(seqs(resumed.seen)[0]).toBe(after + 1);
    expect(seqs(resumed.seen)).toEqual(resumed.seen.map((_, i) => after + 1 + i));
  });

  test("a cursor from another store is not owned and replays from the start", async () => {
    const agent = new Agent({ provider: textProvider(["one"]), model: "mock" });
    const store = new InMemoryEventStore(agent);
    await agent.send("first").final;

    expect(store.owns("deadbeef-3")).toBe(false);
    expect(store.owns(null)).toBe(false);
    const stale = collect(store, "deadbeef-3");
    await waitFor(() => stale.seen.some((entry) => entry.type === "turn:end"));
    stale.stop();
    await stale.done;

    expect(seqs(stale.seen)[0]).toBe(1);
  });

  test("a consumer folding the entries records each turn's closing cursor", async () => {
    const agent = new Agent({ provider: textProvider(["one"]), model: "mock" });
    const store = new InMemoryEventStore(agent);
    const consumer = collect(store);
    const transcript = new Transcript();

    await agent.send("first", { id: "op-1" }).final;
    await waitFor(() => consumer.seen.some((entry) => entry.type === "turn:end"));
    consumer.stop();
    await consumer.done;
    for (const entry of consumer.seen) transcript.apply(entry);

    const [user, assistant] = transcript.turns;
    expect(user.id).toBe("op-1");
    expect(user.cursor).toBe(consumer.seen.find((entry) => entry.type === "turn:user")?.cursor);
    expect(assistant.cursor).toBe(store.lastCursor);
  });
});

describe("InMemoryEventStore status", () => {
  test("a subscriber resuming after the stored turn during a continuation opens busy, then hears idle", async () => {
    const agent = new Agent({ provider: textProvider(["draft", "fix"]), model: "mock" });
    const store = new InMemoryEventStore(agent);
    const { promise: judging, resolve: judgeStarted } = Promise.withResolvers<void>();
    const { promise: verdict, resolve: pass } = Promise.withResolvers<void>();
    const final = agent.send("write", {
      id: "a",
      after: async () => {
        judgeStarted();
        await verdict;
      },
    }).final;
    await judging;
    const storedCursor = store.lastCursor;

    const reloaded = collect(store, storedCursor);
    pass();
    await final;
    await waitFor(() => reloaded.statuses.length === 1);
    reloaded.stop();
    await reloaded.done;

    expect(reloaded.opened).toEqual({ phase: "busy", id: "a" });
    expect(reloaded.seen).toEqual([]);
    expect(reloaded.statuses).toEqual([{ phase: "idle" }]);
    expect(store.lastCursor).toBe(storedCursor);
  });

  test("status is neither stamped nor kept: a later subscriber opens with the current one only", async () => {
    const agent = new Agent({ provider: textProvider(["one"]), model: "mock" });
    const store = new InMemoryEventStore(agent);
    await agent.send("first").final;
    await waitFor(() => agent.status.phase === "idle");

    const late = collect(store);
    await waitFor(() => late.seen.some((entry) => entry.type === "turn:end"));
    late.stop();
    await late.done;

    expect(late.opened).toEqual({ phase: "idle" });
    expect(late.statuses).toEqual([]);
    expect(seqs(late.seen)).toEqual(late.seen.map((_, i) => i + 1));
  });
});

describe("toEventStreamResponse", () => {
  async function readUntilTurnEnd(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): Promise<SseMessage[]> {
    const messages: SseMessage[] = [];
    for await (const message of parseSse(body, signal)) {
      messages.push(message);
      if (message.event === "state") continue;
      const event: TurnEvent = JSON.parse(message.data);
      if (event.type === "turn:end") break;
    }
    return messages;
  }

  test("writes the status first, each entry with its cursor as the SSE id, and status changes with none", async () => {
    const agent = new Agent({ provider: textProvider(["hi there"]), model: "mock" });
    const store = new InMemoryEventStore(agent);
    const controller = new AbortController();
    const request = new Request("http://x/events", { signal: controller.signal });
    const response = toEventStreamResponse(store.subscribe(request.signal), request);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reading = readUntilTurnEnd(response.body!, controller.signal);

    agent.send("hello", { id: "op-1" });
    const messages = await reading;
    controller.abort();

    const [opening, firstEntry, busy] = messages;
    expect(opening).toEqual({
      id: undefined,
      event: "state",
      data: '{"type":"state","status":{"phase":"idle"}}',
    });
    expect(firstEntry.id).toBe(`${store.id}-1`);
    // The parser carries the previous message's id onto a message without one.
    expect(busy).toEqual({
      id: firstEntry.id,
      event: "state",
      data: '{"type":"state","status":{"phase":"busy","id":"op-1"}}',
    });

    const entries = messages.filter((message) => message.event !== "state");
    const transcript = new Transcript();
    for (const message of entries) {
      const entry: StoredEvent = JSON.parse(message.data);
      expect(message.id).toBe(entry.cursor);
      transcript.apply(entry);
    }
    expect(transcript.turns.map((turn) => turn.id)[0]).toBe("op-1");
    expect(transcript.turns.at(-1)?.cursor).toBe(entries.at(-1)?.id);
  });

  test("cancelling the body ends the subscription", async () => {
    const agent = new Agent({ provider: textProvider(["hi"]), model: "mock" });
    const store = new InMemoryEventStore(agent);
    const controller = new AbortController();
    const response = toEventStreamResponse(store.subscribe(controller.signal));
    const reader = response.body!.getReader();
    agent.send("first");
    await reader.read();

    await reader.cancel();
    await agent.send("second").final;

    await expect(reader.read()).resolves.toMatchObject({ done: true });
  });

  test("close ends open subscriptions, stops listening to the agent, and leaves the replay", async () => {
    const agent = new Agent({ provider: textProvider(["one", "two"]), model: "mock" });
    const store = new InMemoryEventStore<HostEvent>(agent);
    await agent.send("first").final;
    const open = collect(store);
    await waitFor(() => open.seen.length > 0);
    const held = store.lastCursor;

    store.close();
    await open.done;
    await agent.send("second").final;
    store.push({ type: "run:start", id: "cycle-2" });
    const later = collect(store);
    await later.done;

    expect(open.seen.at(-1)?.cursor).toBe(held);
    expect(store.lastCursor).toBe(held);
    expect(later.seen.map((event) => event.cursor)).toEqual(open.seen.map((event) => event.cursor));
  });
});
