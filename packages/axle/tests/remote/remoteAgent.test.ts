import { describe, expect, test } from "vitest";
import * as z from "zod";
import { Agent, type AgentStatus } from "../../src/core/agent/index.js";
import { Instruct } from "../../src/core/Instruct.js";
import { AxleAgentAbortError } from "../../src/errors/AxleAgentAbortError.js";
import { InMemoryEventStore } from "../../src/remote/eventStore.js";
import { loopbackTransport } from "../../src/remote/loopback.js";
import { RemoteAgent, type RemoteConnection } from "../../src/remote/RemoteAgent.js";
import type { TurnEvent } from "../../src/turns/events.js";
import { Transcript } from "../../src/turns/transcript.js";
import { askUser, askUserProvider, textProvider, waitFor } from "./helpers.js";

function served(agent: Agent) {
  return loopbackTransport(agent, new InMemoryEventStore(agent));
}

function observe(remote: RemoteAgent) {
  const events: (TurnEvent & { cursor: string })[] = [];
  const connections: RemoteConnection["phase"][] = [remote.connection.phase];
  const statuses: AgentStatus[] = [];
  const transcript = new Transcript();
  remote.on((event) => {
    if (event.type === "state") statuses.push(event.status);
    else events.push(event);
    transcript.apply(event);
  });
  remote.onConnection((connection) => {
    connections.push(connection.phase);
  });
  return { events, connections, statuses, transcript };
}

function lastText(transcript: Transcript): string | undefined {
  const part = transcript.turns.at(-1)?.parts.find((part) => part.type === "text");
  return part?.type === "text" ? part.text : undefined;
}

describe("RemoteAgent", () => {
  test("send resolves from the events with the turn and response, and status follows the served agent", async () => {
    const agent = new Agent({ provider: textProvider(["hi there"]), model: "mock" });
    const remote = new RemoteAgent(served(agent));
    const { events, connections, statuses, transcript } = observe(remote);
    await waitFor(() => remote.connection.phase === "open");

    const result = await remote.send("hello", { id: "op-1" }).final;
    await waitFor(() => remote.status.phase === "idle");
    remote.close();

    expect(result.ok).toBe(true);
    expect(result.response).toBe("hi there");
    expect(result.turn?.parts).toEqual([
      expect.objectContaining({ type: "text", text: "hi there" }),
    ]);
    expect(result.usage).toEqual(expect.objectContaining({ in: 1, out: 1 }));
    expect(events[0]).toMatchObject({ type: "pending:queued", turn: { id: "op-1" } });
    expect(transcript.turns.map((turn) => turn.id)[0]).toBe("op-1");
    expect(connections).toEqual(["connecting", "open", "ended"]);
    expect(statuses).toEqual([{ phase: "idle" }, { phase: "busy", id: "op-1" }, { phase: "idle" }]);
  });

  test("an Instruct with a schema parses the response with the schema this side holds", async () => {
    const agent = new Agent({ provider: textProvider(['{"title":"Teal"}']), model: "mock" });
    const remote = new RemoteAgent(served(agent));
    const instruct = new Instruct({ prompt: "Name it", schema: z.object({ title: z.string() }) });

    const result = await remote.send(instruct).final;
    remote.close();

    expect(result.ok).toBe(true);
    expect(result.response).toEqual({ title: "Teal" });
  });

  test("onToolCall answers the served agent's deferred call from here", async () => {
    const agent = new Agent({ provider: askUserProvider(), model: "mock", tools: [askUser] });
    const remote = new RemoteAgent(served(agent));
    const { transcript } = observe(remote);
    const seen: string[] = [];
    remote.onToolCall((call) => {
      seen.push(`${call.name}:${call.input.question}`);
      return "teal";
    });

    const result = await remote.send("ask").final;
    remote.close();

    expect(seen).toEqual(["ask-user:colour?"]);
    expect(result.ok).toBe(true);
    expect(result.response).toBe("saw ask-user=teal");
    expect(lastText(transcript)).toBe("saw ask-user=teal");
  });

  test("a throw in the handler fails the call; nothing returned leaves it waiting", async () => {
    const agent = new Agent({ provider: askUserProvider(), model: "mock", tools: [askUser] });
    const remote = new RemoteAgent(served(agent));
    remote.onToolCall(() => {
      throw new Error("nobody is here");
    });

    const result = await remote.send("ask").final;
    remote.close();

    expect(result.response).toBe(
      'saw ask-user={"error":{"type":"execution","message":"nobody is here"}}!',
    );
  });

  test("a second consumer sees the waiting call and answers it with toolCall(id)", async () => {
    const agent = new Agent({ provider: askUserProvider(), model: "mock", tools: [askUser] });
    const sender = new RemoteAgent(served(agent));
    const answerer = new RemoteAgent(served(agent));
    const { events } = observe(answerer);
    await waitFor(() => answerer.connection.phase === "open");

    const handle = sender.send("ask");
    await waitFor(() => answerer.toolCall("c1") !== undefined);
    expect(sender.toolCall("c1")).toBeDefined();
    const outcome = await answerer.toolCall("c1")?.answer("teal");
    const result = await handle.final;
    await waitFor(() => answerer.toolCall("c1") === undefined);
    sender.close();
    answerer.close();

    expect(outcome).toEqual({ accepted: true });
    expect(result.response).toBe("saw ask-user=teal");
    expect(events.find((event) => event.type === "action:waiting")).toMatchObject({
      callId: "c1",
      name: "ask-user",
    });
    expect(answerer.connection.phase).toBe("ended");
  });

  test("a RemoteAgent can itself be served: two hops, answered at the far end", async () => {
    const agent = new Agent({ provider: askUserProvider(), model: "mock", tools: [askUser] });
    const hop = new RemoteAgent(served(agent));
    const far = new RemoteAgent(loopbackTransport(hop, new InMemoryEventStore(hop)));
    const { transcript } = observe(far);
    far.onToolCall(() => "teal");

    const result = await far.send("ask", { id: "op-1" }).final;
    far.close();
    hop.close();

    expect(result.ok).toBe(true);
    expect(result.response).toBe("saw ask-user=teal");
    expect(transcript.turns.map((turn) => turn.id)[0]).toBe("op-1");
    expect(lastText(transcript)).toBe("saw ask-user=teal");
  });

  test("cancel aborts the active turn and the send rejects as it does locally", async () => {
    const agent = new Agent({ provider: askUserProvider(), model: "mock", tools: [askUser] });
    const remote = new RemoteAgent(served(agent));
    await waitFor(() => remote.connection.phase === "open");

    const handle = remote.send("ask");
    await waitFor(() => remote.toolCall("c1") !== undefined);
    expect(await remote.cancel()).toBe(true);

    await expect(handle.final).rejects.toBeInstanceOf(AxleAgentAbortError);
    await waitFor(() => remote.status.phase === "idle");
    expect(await remote.cancel()).toBe(false);
    remote.close();
  });

  test("close rejects open sends and ends the connection", async () => {
    const agent = new Agent({ provider: askUserProvider(), model: "mock", tools: [askUser] });
    const remote = new RemoteAgent(served(agent));
    const handle = remote.send("ask");
    await waitFor(() => remote.toolCall("c1") !== undefined);

    remote.close();

    await expect(handle.final).rejects.toBeInstanceOf(AxleAgentAbortError);
    expect(remote.connection).toEqual({ phase: "ended" });
    agent.cancel();
  });
});

describe("RemoteAgent over a store", () => {
  test("a consumer joining mid-turn gets the replay and can answer the waiting call", async () => {
    const agent = new Agent({ provider: askUserProvider(), model: "mock", tools: [askUser] });
    const store = new InMemoryEventStore(agent);
    const first = new RemoteAgent(loopbackTransport(agent, store));
    const handle = first.send("ask", { id: "op-1" });
    await waitFor(() => first.toolCall("c1") !== undefined);

    const late = new RemoteAgent(loopbackTransport(agent, store));
    const { transcript, statuses } = observe(late);
    await waitFor(() => late.toolCall("c1") !== undefined);
    expect(late.status).toEqual({ phase: "busy", id: "op-1" });
    await late.toolCall("c1")?.answer("teal");
    const result = await handle.final;
    await waitFor(() => late.status.phase === "idle");
    first.close();
    late.close();

    expect(result.response).toBe("saw ask-user=teal");
    expect(transcript.turns.map((turn) => turn.id)[0]).toBe("op-1");
    expect(lastText(transcript)).toBe("saw ask-user=teal");
    expect(statuses).toEqual([{ phase: "busy", id: "op-1" }, { phase: "idle" }]);
  });

  test("host events reach on() with their cursor and leave the status alone", async () => {
    type HostEvent = { type: "run:start"; id: string };
    const agent = new Agent({ provider: textProvider(["hi"]), model: "mock" });
    const store = new InMemoryEventStore<HostEvent>(agent);
    const remote = new RemoteAgent<HostEvent>(loopbackTransport(agent, store));
    const seen: string[] = [];
    remote.on((event) => {
      if (event.type !== "state") seen.push(`${event.type}@${event.cursor}`);
    });
    await waitFor(() => remote.connection.phase === "open");

    store.push({ type: "run:start", id: "cycle-1" });
    await waitFor(() => seen.length === 1);
    expect(remote.status).toEqual({ phase: "idle" });
    await remote.send("hello").final;
    remote.close();

    expect(seen[0]).toBe(`run:start@${store.id}-1`);
    expect(seen.at(-1)).toMatch(/^turn:end@/);
  });

  test("a consumer joining while a continuation runs reads busy until it returns", async () => {
    const agent = new Agent({ provider: textProvider(["draft"]), model: "mock" });
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

    const late = new RemoteAgent(loopbackTransport(agent, store));
    const { statuses, transcript } = observe(late);
    await waitFor(() => late.connection.phase === "open");
    await waitFor(() => transcript.turns.at(-1)?.status === "complete");
    expect(late.status).toEqual({ phase: "busy", id: "a" });

    pass();
    await final;
    await waitFor(() => late.status.phase === "idle");
    late.close();

    expect(statuses).toEqual([{ phase: "busy", id: "a" }, { phase: "idle" }]);
  });
});
