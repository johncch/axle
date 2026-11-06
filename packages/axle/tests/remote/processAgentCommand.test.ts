import { describe, expect, test } from "vitest";
import * as z from "zod";
import { Agent } from "../../src/core/agent/index.js";
import { Instruct } from "../../src/core/Instruct.js";
import type { AnyStreamChunk } from "../../src/messages/stream.js";
import type { AIProvider } from "../../src/protocols/types.js";
import { AxleStopReason } from "../../src/protocols/types.js";
import { processAgentCommand } from "../../src/remote/processAgentCommand.js";
import type { TurnEvent } from "../../src/turns/events.js";
import { Transcript } from "../../src/turns/transcript.js";
import { askUser, askUserProvider, sendCommand, textProvider, waitFor } from "./helpers.js";

function observe(agent: Agent) {
  const events: TurnEvent[] = [];
  const transcript = new Transcript();
  agent.on((event) => {
    events.push(event);
    transcript.apply(event);
  });
  return { events, transcript };
}

function waitingCallIds(events: TurnEvent[]): string[] {
  return events.flatMap((event) => (event.type === "action:waiting" ? [event.callId] : []));
}

describe("processAgentCommand", () => {
  test("send queues a user turn under the command's id and the turn runs", async () => {
    const agent = new Agent({ provider: textProvider(["hi there"]), model: "mock" });
    const { events, transcript } = observe(agent);

    const outcome = processAgentCommand(agent, sendCommand("op-1", "hello"));

    expect(outcome).toEqual({ accepted: true });
    expect(events[0]).toMatchObject({ type: "pending:queued", turn: { id: "op-1" } });
    await waitFor(() => events.some((event) => event.type === "turn:end"));
    expect(transcript.turns.map((turn) => turn.id)).toContain("op-1");
    expect(transcript.turns.at(-1)?.parts).toEqual([
      expect.objectContaining({ type: "text", text: "hi there" }),
    ]);
  });

  test("answer settles the waiting call and the model sees the content", async () => {
    const agent = new Agent({ provider: askUserProvider(), model: "mock", tools: [askUser] });
    const { events, transcript } = observe(agent);
    processAgentCommand(agent, sendCommand("op-1", "ask"));
    await waitFor(() => waitingCallIds(events).includes("c1"));

    const outcome = processAgentCommand(agent, { type: "answer", callId: "c1", content: "teal" });

    expect(outcome).toEqual({ accepted: true });
    await waitFor(() => events.some((event) => event.type === "turn:end"));
    expect(transcript.turns.at(-1)?.parts).toContainEqual(
      expect.objectContaining({ type: "text", text: "saw ask-user=teal" }),
    );
  });

  test("fail settles the waiting call as an execution error", async () => {
    const agent = new Agent({ provider: askUserProvider(), model: "mock", tools: [askUser] });
    const { events, transcript } = observe(agent);
    processAgentCommand(agent, sendCommand("op-1", "ask"));
    await waitFor(() => waitingCallIds(events).includes("c1"));

    const outcome = processAgentCommand(agent, {
      type: "fail",
      callId: "c1",
      message: "nobody is here",
    });

    expect(outcome).toEqual({ accepted: true });
    await waitFor(() => events.some((event) => event.type === "turn:end"));
    expect(transcript.turns.at(-1)?.parts).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: 'saw ask-user={"error":{"type":"execution","message":"nobody is here"}}!',
      }),
    );
  });

  test("answer for a call the Agent is not waiting on is not-waiting", () => {
    const agent = new Agent({ provider: textProvider(["unused"]), model: "mock" });

    expect(processAgentCommand(agent, { type: "answer", callId: "c9", content: "x" })).toEqual({
      accepted: false,
      reason: { type: "not-waiting", message: "No waiting call c9" },
    });
    expect(processAgentCommand(agent, { type: "fail", callId: "c9", message: "x" })).toMatchObject({
      accepted: false,
      reason: { type: "not-waiting" },
    });
  });

  test("cancel and stop are idle with no active turn, and take during one", async () => {
    const agent = new Agent({ provider: askUserProvider(), model: "mock", tools: [askUser] });
    const { events } = observe(agent);

    expect(processAgentCommand(agent, { type: "cancel" })).toMatchObject({
      accepted: false,
      reason: { type: "idle" },
    });
    expect(processAgentCommand(agent, { type: "stop" })).toMatchObject({
      accepted: false,
      reason: { type: "idle" },
    });

    processAgentCommand(agent, sendCommand("op-1", "ask"));
    await waitFor(() => waitingCallIds(events).includes("c1"));

    expect(processAgentCommand(agent, { type: "stop" })).toEqual({ accepted: true });
    expect(processAgentCommand(agent, { type: "cancel" })).toEqual({ accepted: true });
    await waitFor(() => events.some((event) => event.type === "turn:end"));
    expect(events.at(-1)).toMatchObject({ type: "turn:end", status: "cancelled" });
  });

  test("clear drops queued sends and is always accepted", async () => {
    const agent = new Agent({ provider: askUserProvider(), model: "mock", tools: [askUser] });
    const { events } = observe(agent);
    processAgentCommand(agent, sendCommand("op-1", "ask"));
    processAgentCommand(agent, sendCommand("op-2", "queued"));
    await waitFor(() => waitingCallIds(events).includes("c1"));

    expect(processAgentCommand(agent, { type: "clear" })).toEqual({ accepted: true });

    expect(events.at(-1)).toMatchObject({
      type: "pending:dropped",
      id: "op-2",
      reason: { type: "cancelled" },
    });
    processAgentCommand(agent, { type: "cancel" });
    await waitFor(() => events.some((event) => event.type === "turn:end"));
  });
});

describe("processAgentCommand send carries an Instruct", () => {
  function capturingProvider() {
    const prompts: string[] = [];
    const fileParts: unknown[] = [];
    const provider: AIProvider = {
      protocol: "chatCompletions",
      id: "capturing",
      async *createStreamingRequest(_model, { messages }): AsyncGenerator<AnyStreamChunk, void> {
        const user = messages.findLast((message) => message.role === "user");
        if (user?.role === "user" && typeof user.content === "string") prompts.push(user.content);
        if (user?.role === "user" && typeof user.content !== "string") {
          for (const part of user.content) {
            if (part.type === "text") prompts.push(part.text);
            else fileParts.push(part);
          }
        }
        yield { type: "start", id: "r1", data: { model: "mock", timestamp: 0 } };
        yield { type: "text-start", data: { index: 0 } };
        yield { type: "text-delta", data: { index: 0, text: '{"title":"ok"}' } };
        yield { type: "text-complete", data: { index: 0 } };
        yield {
          type: "complete",
          data: { finishReason: AxleStopReason.Stop, usage: { in: 1, out: 1 } },
        };
      },
    };
    return { provider, prompts, fileParts };
  }

  test("a ref file reaches the user message intact and a schema renders its instructions", async () => {
    const { provider, prompts, fileParts } = capturingProvider();
    const agent = new Agent({ provider, model: "mock" });
    const { events } = observe(agent);
    const instruct = new Instruct({
      prompt: "Rate {{thing}}",
      schema: z.object({ title: z.string() }),
    }).withInputs({ thing: "the report" });
    instruct.addFile({
      kind: "text",
      mimeType: "text/plain",
      name: "report.txt",
      source: { type: "ref", ref: { id: "file-1" } },
    });

    const outcome = processAgentCommand(agent, {
      type: "send",
      id: "op-1",
      instruct: JSON.parse(JSON.stringify(instruct)),
    });
    await waitFor(() => events.some((event) => event.type === "turn:end"));

    expect(outcome).toEqual({ accepted: true });
    expect(prompts.join("\n")).toContain("Rate the report");
    expect(prompts.join("\n")).toContain("Output Format Instructions");
    expect(fileParts).toEqual([
      expect.objectContaining({
        type: "file",
        file: expect.objectContaining({
          name: "report.txt",
          source: { type: "ref", ref: { id: "file-1" } },
        }),
      }),
    ]);
  });
});
