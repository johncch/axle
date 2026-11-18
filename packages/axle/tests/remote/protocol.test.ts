import { describe, expect, test } from "vitest";
import * as z from "zod";
import { Agent } from "../../src/core/agent/index.js";
import { Instruct } from "../../src/core/Instruct.js";
import { toJsonSchema } from "../../src/core/parse.js";
import type { AnyStreamChunk } from "../../src/messages/stream.js";
import type { AIProvider } from "../../src/protocols/types.js";
import { AxleStopReason } from "../../src/protocols/types.js";
import { InMemoryEventStore } from "../../src/remote/eventStore.js";
import { loopbackTransport } from "../../src/remote/loopback.js";
import { type AgentCommand, parseAgentCommand } from "../../src/remote/protocol.js";
import { RemoteAgent } from "../../src/remote/RemoteAgent.js";
import type { FileInfo } from "../../src/utils/file.js";
import { applyCommand } from "./helpers.js";

function capturingProvider() {
  const prompts: string[] = [];
  const files: FileInfo[] = [];
  const provider: AIProvider = {
    protocol: "chatCompletions",
    id: "capturing",
    async *createStreamingRequest(_model, { messages }): AsyncGenerator<AnyStreamChunk, void> {
      const user = messages.findLast((message) => message.role === "user");
      if (user?.role === "user" && typeof user.content === "string") prompts.push(user.content);
      if (user?.role === "user" && typeof user.content !== "string") {
        for (const part of user.content) {
          if (part.type === "text") prompts.push(part.text);
          if (part.type === "file") files.push(part.file);
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
  return { provider, prompts, files };
}

describe("the send command", () => {
  test("carries the Instruct as data, its schema as JSON Schema, and the served side renders it", async () => {
    const { provider, prompts, files } = capturingProvider();
    const agent = new Agent({ provider, model: "mock" });
    const store = new InMemoryEventStore(agent);
    const posted: AgentCommand[] = [];
    const remote = new RemoteAgent(
      loopbackTransport(store, async (command) => {
        const parsed = parseAgentCommand(JSON.parse(JSON.stringify(command)));
        if (!parsed) throw new Error("not a command");
        posted.push(parsed);
        return applyCommand(agent, parsed);
      }),
    );
    const instruct = new Instruct({
      prompt: "Rate {{thing}}",
      schema: z.object({ title: z.string() }),
    }).withInputs({ thing: "the report" });
    instruct.addFile({
      kind: "text",
      mimeType: "text/plain",
      name: "report.txt",
      source: { type: "ref", ref: { key: "uploads/abc123" } },
    });

    const result = await remote.send(instruct, { id: "op-1", metadata: { origin: "web" } }).final;
    remote.close();

    expect(result.response).toEqual({ title: "ok" });
    expect(posted).toEqual([
      {
        type: "send",
        id: "op-1",
        instruct: {
          prompt: "Rate {{thing}}",
          inputs: { thing: "the report" },
          files: [
            expect.objectContaining({ source: { type: "ref", ref: { key: "uploads/abc123" } } }),
          ],
          metadata: { origin: "web" },
          schema: toJsonSchema(instruct.schema),
        },
      },
    ]);
    expect(prompts.join("\n")).toContain("Rate the report");
    expect(prompts.join("\n")).toContain("Output Format Instructions");
    expect(files).toEqual([expect.objectContaining({ name: "report.txt" })]);
    expect(agent.messages[0]).toMatchObject({
      id: "op-1",
      metadata: { origin: "web" },
      output: { schema: toJsonSchema(instruct.schema) },
    });
  });

  test("the client validates an answer the served side only parsed as JSON", async () => {
    const { provider } = capturingProvider();
    const agent = new Agent({ provider, model: "mock" });
    const store = new InMemoryEventStore(agent);
    const remote = new RemoteAgent(
      loopbackTransport(store, async (command) => applyCommand(agent, command)),
    );

    const result = await remote.send(
      new Instruct({ prompt: "Rate it", schema: z.object({ title: z.number() }) }),
    ).final;
    remote.close();

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("parse");
    expect(result.turn).toMatchObject({
      status: "complete",
      output: { schema: { type: "object" } },
    });
  });

  test("a missing variable is rejected before anything is sent", () => {
    const posted: AgentCommand[] = [];
    const agent = new Agent({ provider: capturingProvider().provider, model: "mock" });
    const remote = new RemoteAgent(
      loopbackTransport(new InMemoryEventStore(agent), async (command) => {
        posted.push(command);
        return { accepted: true };
      }),
    );

    expect(() => remote.send(new Instruct({ prompt: "Rate {{thing}}" }))).toThrow(
      "Missing variable: thing",
    );
    remote.close();
    expect(posted).toEqual([]);
  });
});

describe("parseAgentCommand", () => {
  test("returns the command a body describes", () => {
    expect(parseAgentCommand({ type: "answer", callId: "c1", content: "teal" })).toEqual({
      type: "answer",
      callId: "c1",
      content: "teal",
    });
  });

  test.each([
    ["an unknown type", { type: "reset" }],
    ["a send without an id", { type: "send", instruct: { prompt: "hi" } }],
    ["a send carrying a rendered prompt", { type: "send", id: "op-1", prompt: "hi" }],
    [
      "an input that is not a string, number, boolean or null",
      { type: "send", id: "op-1", instruct: { prompt: "hi", inputs: { when: { nested: true } } } },
    ],
    [
      "a file with a source its kind cannot have",
      {
        type: "send",
        id: "op-1",
        instruct: {
          prompt: "hi",
          files: [
            {
              kind: "image",
              mimeType: "image/png",
              name: "a.png",
              source: { type: "text", content: "x" },
            },
          ],
        },
      },
    ],
    ["a body that is not an object", "cancel"],
  ])("returns null for %s", (_label, body) => {
    expect(parseAgentCommand(body)).toBeNull();
  });
});
