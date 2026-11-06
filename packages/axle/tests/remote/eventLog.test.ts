import { describe, expect, test } from "vitest";
import { Agent } from "../../src/core/agent/index.js";
import { EventLog, type LoggedEvent } from "../../src/remote/eventLog.js";
import { parseSse, toEventStreamResponse, type SseMessage } from "../../src/remote/sse.js";
import type { TurnEvent } from "../../src/turns/events.js";
import { Transcript } from "../../src/turns/transcript.js";
import { textProvider, waitFor } from "./helpers.js";

type HostEvent = { type: "run:start"; id: string };

function collect<T extends { type: string }>(log: EventLog<T>, after?: string) {
  const controller = new AbortController();
  const seen: LoggedEvent<T>[] = [];
  const done = (async () => {
    for await (const entry of log.subscribe(controller.signal, after)) seen.push(entry);
  })();
  return { seen, stop: () => controller.abort(), done };
}

function seqs(entries: { cursor: string }[]): number[] {
  return entries.map((entry) => Number(entry.cursor.split("-")[1]));
}

describe("EventLog", () => {
  test("stamps agent and host events in order and replays everything to a late subscriber", async () => {
    const agent = new Agent({ provider: textProvider(["one", "two"]), model: "mock" });
    const log = new EventLog<HostEvent>(agent);
    log.push({ type: "run:start", id: "cycle-1" });
    await agent.send("first").final;
    const countBefore = Number(log.lastCursor.split("-")[1]);

    const late = collect(log);
    await agent.send("second").final;
    await waitFor(() => seqs(late.seen).at(-1) === Number(log.lastCursor.split("-")[1]));
    late.stop();
    await late.done;

    expect(countBefore).toBeGreaterThan(1);
    expect(late.seen[0]).toMatchObject({ type: "run:start", id: "cycle-1", cursor: `${log.id}-1` });
    expect(seqs(late.seen)).toEqual(late.seen.map((_, i) => i + 1));
    expect(late.seen.filter((entry) => entry.type === "turn:end")).toHaveLength(2);
  });

  test("a subscriber with an owned cursor gets only what came after, once, across the live boundary", async () => {
    const agent = new Agent({ provider: textProvider(["one", "two", "three"]), model: "mock" });
    const log = new EventLog(agent);
    await agent.send("first").final;
    const cursor = log.lastCursor;

    expect(log.owns(cursor)).toBe(true);
    const resumed = collect(log, cursor);
    agent.send("second");
    await agent.send("third").final;
    await waitFor(() => resumed.seen.filter((entry) => entry.type === "turn:end").length === 2);
    resumed.stop();
    await resumed.done;

    const after = Number(cursor.split("-")[1]);
    expect(seqs(resumed.seen)[0]).toBe(after + 1);
    expect(seqs(resumed.seen)).toEqual(resumed.seen.map((_, i) => after + 1 + i));
  });

  test("a cursor from another log is not owned and replays from the start", async () => {
    const agent = new Agent({ provider: textProvider(["one"]), model: "mock" });
    const log = new EventLog(agent);
    await agent.send("first").final;

    expect(log.owns("deadbeef-3")).toBe(false);
    expect(log.owns(null)).toBe(false);
    const stale = collect(log, "deadbeef-3");
    await waitFor(() => stale.seen.some((entry) => entry.type === "turn:end"));
    stale.stop();
    await stale.done;

    expect(seqs(stale.seen)[0]).toBe(1);
  });

  test("retain none keeps nothing: a late subscriber starts live", async () => {
    const agent = new Agent({ provider: textProvider(["one", "two"]), model: "mock" });
    const log = new EventLog(agent, { retain: "none" });
    await agent.send("first").final;

    const late = collect(log);
    await agent.send("second").final;
    await waitFor(() => late.seen.some((entry) => entry.type === "turn:end"));
    late.stop();
    await late.done;

    expect(seqs(late.seen)[0]).toBeGreaterThan(1);
    expect(late.seen.filter((entry) => entry.type === "turn:end")).toHaveLength(1);
  });

  test("a consumer folding the entries records each turn's closing cursor", async () => {
    const agent = new Agent({ provider: textProvider(["one"]), model: "mock" });
    const log = new EventLog(agent);
    const consumer = collect(log);
    const transcript = new Transcript();

    await agent.send("first", { id: "op-1" }).final;
    await waitFor(() => consumer.seen.some((entry) => entry.type === "turn:end"));
    consumer.stop();
    await consumer.done;
    for (const entry of consumer.seen) transcript.apply(entry);

    const [user, assistant] = transcript.turns;
    expect(user.id).toBe("op-1");
    expect(user.cursor).toBe(consumer.seen.find((entry) => entry.type === "turn:user")?.cursor);
    expect(assistant.cursor).toBe(log.lastCursor);
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
      const event: TurnEvent = JSON.parse(message.data);
      if (event.type === "turn:end") break;
    }
    return messages;
  }

  test("writes each entry with its cursor as the SSE id", async () => {
    const agent = new Agent({ provider: textProvider(["hi there"]), model: "mock" });
    const log = new EventLog(agent);
    const controller = new AbortController();
    const request = new Request("http://x/events", { signal: controller.signal });
    const response = toEventStreamResponse(log.subscribe(request.signal), request);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reading = readUntilTurnEnd(response.body!, controller.signal);

    agent.send("hello", { id: "op-1" });
    const messages = await reading;
    controller.abort();

    const transcript = new Transcript();
    for (const message of messages) {
      const entry: LoggedEvent = JSON.parse(message.data);
      expect(message.id).toBe(entry.cursor);
      transcript.apply(entry);
    }
    expect(messages[0].id).toBe(`${log.id}-1`);
    expect(transcript.turns.map((turn) => turn.id)[0]).toBe("op-1");
    expect(transcript.turns.at(-1)?.cursor).toBe(messages.at(-1)?.id);
  });

  test("cancelling the body ends the subscription", async () => {
    const agent = new Agent({ provider: textProvider(["hi"]), model: "mock" });
    const log = new EventLog(agent);
    const controller = new AbortController();
    const response = toEventStreamResponse(log.subscribe(controller.signal));
    const reader = response.body!.getReader();
    agent.send("first");
    await reader.read();

    await reader.cancel();
    await agent.send("second").final;

    await expect(reader.read()).resolves.toMatchObject({ done: true });
  });
});
