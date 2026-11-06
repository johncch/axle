import { describe, expect, test } from "vitest";
import * as z from "zod";
import { Agent } from "../../src/core/agent/index.js";
import { Instruct } from "../../src/core/Instruct.js";
import { AxleAgentAbortError } from "../../src/errors/AxleAgentAbortError.js";
import { loopbackTransport } from "../../src/remote/loopback.js";
import { RemoteAgent, type RemoteAgentState } from "../../src/remote/RemoteAgent.js";
import type { TurnEvent } from "../../src/turns/events.js";
import { Transcript } from "../../src/turns/transcript.js";
import { askUser, askUserProvider, textProvider, waitFor } from "./helpers.js";

function observe(remote: RemoteAgent) {
  const events: (TurnEvent & { cursor: string })[] = [];
  const states: RemoteAgentState["phase"][] = [remote.state.phase];
  const transcript = new Transcript();
  remote.on((event) => {
    events.push(event);
    transcript.apply(event);
  });
  remote.onState((state) => {
    states.push(state.phase);
  });
  return { events, states, transcript };
}

function lastText(transcript: Transcript): string | undefined {
  const part = transcript.turns.at(-1)?.parts.find((part) => part.type === "text");
  return part?.type === "text" ? part.text : undefined;
}

describe("RemoteAgent", () => {
  test("send resolves from the events with the turn and response, and state follows", async () => {
    const agent = new Agent({ provider: textProvider(["hi there"]), model: "mock" });
    const remote = new RemoteAgent(loopbackTransport(agent));
    const { events, states, transcript } = observe(remote);
    await waitFor(() => remote.state.phase === "idle");

    const result = await remote.send("hello", { id: "op-1" }).final;
    remote.close();

    expect(result.ok).toBe(true);
    expect(result.response).toBe("hi there");
    expect(result.turn?.parts).toEqual([
      expect.objectContaining({ type: "text", text: "hi there" }),
    ]);
    expect(result.usage).toEqual(expect.objectContaining({ in: 1, out: 1 }));
    expect(events[0]).toMatchObject({ type: "pending:queued", turn: { id: "op-1" } });
    expect(transcript.turns.map((turn) => turn.id)[0]).toBe("op-1");
    expect(states).toEqual(["connecting", "idle", "busy", "busy", "idle", "ended"]);
  });

  test("an Instruct with a schema parses the response with the schema this side holds", async () => {
    const agent = new Agent({ provider: textProvider(['{"title":"Teal"}']), model: "mock" });
    const remote = new RemoteAgent(loopbackTransport(agent));
    const instruct = new Instruct({ prompt: "Name it", schema: z.object({ title: z.string() }) });

    const result = await remote.send(instruct).final;
    remote.close();

    expect(result.ok).toBe(true);
    expect(result.response).toEqual({ title: "Teal" });
  });

  test("onToolCall answers the served agent's deferred call from here", async () => {
    const agent = new Agent({ provider: askUserProvider(), model: "mock", tools: [askUser] });
    const remote = new RemoteAgent(loopbackTransport(agent));
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
    const remote = new RemoteAgent(loopbackTransport(agent));
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
    const sender = new RemoteAgent(loopbackTransport(agent));
    const answerer = new RemoteAgent(loopbackTransport(agent));
    const { events } = observe(answerer);
    await waitFor(() => answerer.state.phase === "idle");

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
    expect(answerer.state.phase).toBe("ended");
  });

  test("a RemoteAgent can itself be served: two hops, answered at the far end", async () => {
    const agent = new Agent({ provider: askUserProvider(), model: "mock", tools: [askUser] });
    const hop = new RemoteAgent(loopbackTransport(agent));
    const far = new RemoteAgent(loopbackTransport(hop));
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
    const remote = new RemoteAgent(loopbackTransport(agent));
    await waitFor(() => remote.state.phase === "idle");

    const handle = remote.send("ask");
    await waitFor(() => remote.toolCall("c1") !== undefined);
    expect(await remote.cancel()).toBe(true);

    await expect(handle.final).rejects.toBeInstanceOf(AxleAgentAbortError);
    await waitFor(() => remote.state.phase === "idle");
    expect(await remote.cancel()).toBe(false);
    remote.close();
  });

  test("close rejects open sends and ends the state", async () => {
    const agent = new Agent({ provider: askUserProvider(), model: "mock", tools: [askUser] });
    const remote = new RemoteAgent(loopbackTransport(agent));
    const handle = remote.send("ask");
    await waitFor(() => remote.toolCall("c1") !== undefined);

    remote.close();

    await expect(handle.final).rejects.toBeInstanceOf(AxleAgentAbortError);
    expect(remote.state).toEqual({ phase: "ended" });
    agent.cancel();
  });
});
