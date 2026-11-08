import { describe, expect, test } from "vitest";
import { Agent } from "../../src/core/agent/index.js";
import { InMemoryEventStore } from "../../src/remote/eventStore.js";
import type { AgentTransport } from "../../src/remote/protocol.js";
import type { TurnEvent } from "../../src/turns/events.js";
import { Transcript } from "../../src/turns/transcript.js";
import { askUser, askUserProvider, sendCommand, served, textProvider, waitFor } from "./helpers.js";

function consume(transport: AgentTransport) {
  const controller = new AbortController();
  const events: (TurnEvent & { cursor: string })[] = [];
  const transcript = new Transcript();
  const done = (async () => {
    const subscription = await transport.events(controller.signal);
    for await (const item of subscription?.items ?? []) {
      if (item.type === "welcome") continue;
      events.push(item);
      transcript.apply(item);
    }
  })();
  return { events, transcript, stop: () => controller.abort(), done };
}

describe("loopbackTransport", () => {
  test("a consumer sends through the transport and folds the events it hears back", async () => {
    const agent = new Agent({ provider: textProvider(["hi there"]), model: "mock" });
    const store = new InMemoryEventStore(agent);
    const transport = served(agent, store);
    const consumer = consume(transport);

    const outcome = await transport.command(sendCommand("op-1", "hello"));
    await waitFor(() => consumer.events.some((event) => event.type === "turn:end"));
    consumer.stop();
    await consumer.done;

    expect(outcome).toEqual({ accepted: true });
    expect(consumer.events[0]).toMatchObject({
      type: "pending:queued",
      turn: { id: "op-1" },
      cursor: `${store.id}-1`,
    });
    expect(consumer.transcript.turns.map((turn) => turn.id)[0]).toBe("op-1");
    expect(consumer.transcript.turns.at(-1)?.parts).toEqual([
      expect.objectContaining({ type: "text", text: "hi there" }),
    ]);
  });

  test("a second consumer answers the waiting call it saw on its own stream", async () => {
    const agent = new Agent({ provider: askUserProvider(), model: "mock", tools: [askUser] });
    const store = new InMemoryEventStore(agent);
    const transport = served(agent, store);
    const sender = consume(transport);
    const answerer = consume(transport);

    await transport.command(sendCommand("op-1", "ask"));
    await waitFor(() => answerer.events.some((event) => event.type === "action:waiting"));
    const waiting = answerer.events.find((event) => event.type === "action:waiting");
    const outcome =
      waiting?.type === "action:waiting"
        ? await transport.command({ type: "answer", callId: waiting.callId, content: "teal" })
        : undefined;
    await waitFor(() => sender.events.some((event) => event.type === "turn:end"));
    sender.stop();
    answerer.stop();
    await Promise.all([sender.done, answerer.done]);

    expect(waiting).toMatchObject({ type: "action:waiting", name: "ask-user" });
    expect(outcome).toEqual({ accepted: true });
    for (const consumer of [sender, answerer]) {
      expect(consumer.transcript.turns.at(-1)?.parts).toContainEqual(
        expect.objectContaining({ type: "text", text: "saw ask-user=teal" }),
      );
    }
    expect(sender.events.map((event) => event.cursor)).toEqual(
      answerer.events.map((event) => event.cursor),
    );
  });
});
