import { describe, expect, test } from "vitest";
import * as z from "zod";
import { Agent } from "../../src/core/agent/Agent.js";
import { Instruct } from "../../src/core/Instruct.js";
import { outputInstructions, withOutputInstructions } from "../../src/execution/output.js";
import { stream } from "../../src/execution/stream.js";
import type { AxleMessage } from "../../src/messages/message.js";
import type { AnyStreamChunk } from "../../src/messages/stream.js";
import type { AIProvider, ProviderStreamParams } from "../../src/protocols/types.js";
import { AxleStopReason } from "../../src/protocols/types.js";
import type { TurnEvent } from "../../src/turns/events.js";
import {
  completeChunk,
  startChunk,
  textChunk,
  textCompleteChunk,
  textStartChunk,
  toolCallCompleteChunk,
  toolCallStartChunk,
} from "../scenarios/helpers/chunks.js";

const schema = { type: "object", properties: { answer: { type: "string" } } };
const instructions = outputInstructions(schema);

function textResponse(text: string): AnyStreamChunk[] {
  return [
    startChunk(),
    textStartChunk(0),
    textChunk(0, text),
    textCompleteChunk(0),
    completeChunk(AxleStopReason.Stop),
  ];
}

function toolResponse(): AnyStreamChunk[] {
  return [
    startChunk(),
    toolCallStartChunk(0, "call-1", "lookup"),
    toolCallCompleteChunk(0, "call-1", "lookup", {}),
    completeChunk(AxleStopReason.FunctionCall),
  ];
}

function scriptedProvider(
  requests: ProviderStreamParams[],
  responses: AnyStreamChunk[][],
): AIProvider {
  let call = 0;
  return {
    protocol: "chatCompletions",
    id: "test",
    async *createStreamingRequest(_model, params) {
      requests.push({ ...params, messages: [...params.messages] });
      for (const chunk of responses[call++] ?? textResponse("{}")) yield chunk;
    },
  };
}

function firstText(message: AxleMessage): string {
  if (message.role !== "user") return "";
  if (typeof message.content === "string") return message.content;
  const part = message.content.find((candidate) => candidate.type === "text");
  return part?.type === "text" ? part.text : "";
}

const lookup = {
  name: "lookup",
  description: "Look something up",
  schema: z.object({}),
  execute: async () => "found",
};

describe("withOutputInstructions", () => {
  test("writes the schema ahead of a string message", () => {
    const [message] = withOutputInstructions([
      { role: "user", content: "Answer", output: { schema } },
    ]);

    expect(message.content).toBe(`${instructions}Answer`);
  });

  test("writes the schema into the first text part and keeps the others", () => {
    const file = {
      type: "file" as const,
      file: {
        kind: "text" as const,
        mimeType: "text/plain",
        name: "a.txt",
        source: { type: "url" as const, url: "https://example.com/a.txt" },
      },
    };
    const [message] = withOutputInstructions([
      { role: "user", content: [file, { type: "text", text: "Answer" }], output: { schema } },
    ]);

    expect(message.content).toEqual([file, { type: "text", text: `${instructions}Answer` }]);
  });

  test("adds a text part when the message has none", () => {
    const [message] = withOutputInstructions([{ role: "user", content: [], output: { schema } }]);

    expect(message.content).toEqual([{ type: "text", text: instructions }]);
  });

  test("leaves the given messages and those without a schema untouched", () => {
    const plain: AxleMessage = { role: "user", content: "Hello" };
    const asking: AxleMessage = { role: "user", content: "Answer", output: { schema } };
    const result = withOutputInstructions([plain, asking]);

    expect(result[0]).toBe(plain);
    expect(asking.content).toBe("Answer");
  });
});

describe("stream() with an output schema", () => {
  test("writes the schema into the prompt on every step", async () => {
    const requests: ProviderStreamParams[] = [];
    const provider = scriptedProvider(requests, [toolResponse(), textResponse('{"answer":"yes"}')]);

    const result = await stream({
      provider,
      model: "test-model",
      tools: [lookup],
      instruct: new Instruct({ prompt: "Answer", schema }),
    }).final;

    expect(result.ok && result.response).toEqual({ answer: "yes" });
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(firstText(request.messages[0])).toBe(`${instructions}Answer`);
    }
  });

  test("an earlier message keeps its schema text on a later request", async () => {
    const requests: ProviderStreamParams[] = [];
    const provider = scriptedProvider(requests, [textResponse("fine")]);

    await stream({
      provider,
      model: "test-model",
      messages: [
        { role: "user", content: "Answer", output: { schema } },
        { role: "assistant", id: "a", content: [{ type: "text", text: '{"answer":"yes"}' }] },
        { role: "user", content: "Thanks" },
      ],
    }).final;

    expect(firstText(requests[0].messages[0])).toBe(`${instructions}Answer`);
    expect(firstText(requests[0].messages[2])).toBe("Thanks");
  });
});

describe("Agent with an output schema", () => {
  function setup(response: string) {
    const requests: ProviderStreamParams[] = [];
    const agent = new Agent({
      provider: scriptedProvider(requests, [textResponse(response)]),
      model: "test-model",
    });
    const events: TurnEvent[] = [];
    agent.on((event) => events.push(event as TurnEvent));
    return { agent, requests, events };
  }

  const zodSchema = z.object({ answer: z.string() });
  const jsonSchema = z.toJSONSchema(zodSchema, { io: "input" });

  test("stores the clean prompt and the schema, and sends the instructions", async () => {
    const { agent, requests } = setup('{"answer":"yes"}');

    const result = await agent.send(new Instruct({ prompt: "Answer", schema: zodSchema })).final;

    expect(result.ok && result.response).toEqual({ answer: "yes" });
    expect(firstText(agent.messages[0])).toBe("Answer");
    expect(agent.messages[0]).toMatchObject({ output: { schema: jsonSchema } });
    expect(firstText(requests[0].messages[0])).toBe(`${outputInstructions(jsonSchema)}Answer`);
  });

  test("records the schema on the user turn and the agent turn", async () => {
    const { agent, events } = setup('{"answer":"yes"}');

    const result = await agent.send(new Instruct({ prompt: "Answer", schema: zodSchema })).final;

    const userEvent = events.find((event) => event.type === "turn:user");
    expect(userEvent?.type === "turn:user" && userEvent.turn.output).toEqual({
      schema: jsonSchema,
    });
    expect(userEvent?.type === "turn:user" && userEvent.turn.parts).toMatchObject([
      { type: "text", text: "Answer" },
    ]);
    expect(result.turn?.output).toEqual({ schema: jsonSchema });
  });

  test("leaves a send without a schema unmarked", async () => {
    const { agent } = setup("hello");

    const result = await agent.send("Hi").final;

    expect(result.ok && result.response).toBe("hello");
    expect(result.turn?.output).toBeUndefined();
    expect(agent.messages[0]).not.toHaveProperty("output");
  });

  test("an answer the schema rejects is a parse failure on the result and the turn", async () => {
    const { agent } = setup('{"answer":42}');

    const result = await agent.send(new Instruct({ prompt: "Answer", schema: zodSchema })).final;

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("parse");
    expect(result.turn).toMatchObject({
      status: "error",
      failure: { kind: "parse" },
      output: { schema: jsonSchema },
    });
  });

  test("a later plain send still sends the earlier schema text", async () => {
    const requests: ProviderStreamParams[] = [];
    const agent = new Agent({
      provider: scriptedProvider(requests, [textResponse('{"answer":"yes"}'), textResponse("ok")]),
      model: "test-model",
    });

    await agent.send(new Instruct({ prompt: "Answer", schema: zodSchema })).final;
    await agent.send("Thanks").final;

    expect(firstText(requests[1].messages[0])).toBe(firstText(requests[0].messages[0]));
    expect(firstText(requests[1].messages[2])).toBe("Thanks");
  });
});
