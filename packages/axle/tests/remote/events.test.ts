import { describe, expect, test } from "vitest";
import { Agent } from "../../src/core/agent/index.js";
import { agentEvents, eventResponse } from "../../src/remote/events.js";
import { parseSse, type SseMessage } from "../../src/remote/sse.js";
import type { TurnEvent } from "../../src/turns/events.js";
import { Transcript } from "../../src/turns/transcript.js";
import { textProvider, waitFor } from "./helpers.js";

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

describe("agentEvents", () => {
  test("yields the agent's events from subscription until the signal aborts", async () => {
    const agent = new Agent({ provider: textProvider(["one", "two"]), model: "mock" });
    await agent.send("before").final;
    const controller = new AbortController();
    const seen: string[] = [];
    const reading = (async () => {
      for await (const event of agentEvents(agent, controller.signal)) seen.push(event.cursor);
    })();

    await agent.send("after").final;
    await waitFor(() => seen.length > 0);
    const countAfterOneTurn = seen.length;
    controller.abort();
    await reading;
    await agent.send("unseen").final;

    expect(seen).toHaveLength(countAfterOneTurn);
    expect(seen.every((cursor) => cursor.startsWith(`${agent.instanceId}-`))).toBe(true);
    expect(Number(seen[0].split("-")[1])).toBeGreaterThan(1);
  });
});

describe("eventResponse", () => {
  test("streams each event as SSE with the cursor as id and the event as data", async () => {
    const agent = new Agent({ provider: textProvider(["hi there"]), model: "mock" });
    const controller = new AbortController();
    const response = eventResponse(
      agent,
      new Request("http://x/events", { signal: controller.signal }),
    );
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reading = readUntilTurnEnd(response.body!, controller.signal);

    agent.send("hello", { id: "op-1" });
    const messages = await reading;
    controller.abort();

    const transcript = new Transcript();
    for (const message of messages) {
      const event: TurnEvent & { cursor: string } = JSON.parse(message.data);
      expect(message.id).toBe(event.cursor);
      transcript.apply(event);
    }
    expect(messages[0].id).toBe(`${agent.instanceId}-1`);
    expect(transcript.turns.map((turn) => turn.id)[0]).toBe("op-1");
    expect(transcript.turns.at(-1)?.parts).toEqual([
      expect.objectContaining({ type: "text", text: "hi there" }),
    ]);
  });

  test("cancelling the body unsubscribes from the agent", async () => {
    const agent = new Agent({ provider: textProvider(["hi"]), model: "mock" });
    const response = eventResponse(agent);
    const reader = response.body!.getReader();
    agent.send("first");
    await reader.read();

    await reader.cancel();
    const after = await agent.send("second").final;

    expect(after.ok).toBe(true);
    await expect(reader.read()).resolves.toMatchObject({ done: true });
  });
});
