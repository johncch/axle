import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { Agent } from "../../src/core/agent/index.js";
import { Instruct } from "../../src/core/Instruct.js";
import { createStreamingRequest as anthropic } from "../../src/providers/anthropic/createStreamingRequest.js";
import { createStreamingRequest as chat } from "../../src/providers/chatcompletions/createStreamingRequest.js";
import { createStreamingRequest as gemini } from "../../src/providers/gemini/createStreamingRequest.js";
import { generate } from "../../src/providers/generate.js";
import { createStreamingRequest as openai } from "../../src/providers/openai/createStreamingRequest.js";
import { stream, type StreamEvent } from "../../src/providers/stream.js";
import type { AIProvider, Refusal } from "../../src/providers/types.js";
import { AxleStopReason } from "../../src/providers/types.js";

type Api = "openai" | "anthropic" | "gemini" | "chat";

interface RefusalCase {
  name: string;
  api: Api;
  wire: object[];
  refusal: Refusal;
  message: string;
  usage: { in: number; out: number };
}

const REFUSAL_TEXT = "I'm sorry, I can't help with that.";
const EXPLANATION = "This request was declined because it could enable cyber harm.";

const anthropicStart = {
  type: "message_start",
  message: {
    id: "msg_1",
    model: "claude-x",
    role: "assistant",
    content: [],
    usage: { input_tokens: 412, output_tokens: 0 },
  },
};

const cases: RefusalCase[] = [
  {
    name: "OpenAI refusal content part",
    api: "openai",
    wire: [
      { type: "response.created", response: { id: "resp_1", model: "gpt-x" } },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "message", id: "msg_1", role: "assistant", content: [] },
      },
      {
        type: "response.content_part.added",
        item_id: "msg_1",
        output_index: 0,
        content_index: 0,
        part: { type: "refusal", refusal: "" },
      },
      {
        type: "response.refusal.delta",
        item_id: "msg_1",
        output_index: 0,
        content_index: 0,
        delta: REFUSAL_TEXT,
      },
      {
        type: "response.refusal.done",
        item_id: "msg_1",
        output_index: 0,
        content_index: 0,
        refusal: REFUSAL_TEXT,
      },
      {
        type: "response.content_part.done",
        item_id: "msg_1",
        output_index: 0,
        content_index: 0,
        part: { type: "refusal", refusal: REFUSAL_TEXT },
      },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "message",
          id: "msg_1",
          role: "assistant",
          content: [{ type: "refusal", refusal: REFUSAL_TEXT }],
        },
      },
      {
        type: "response.completed",
        response: {
          id: "resp_1",
          status: "completed",
          incomplete_details: null,
          usage: { input_tokens: 10, output_tokens: 9 },
        },
      },
    ],
    refusal: { text: REFUSAL_TEXT },
    message: REFUSAL_TEXT,
    usage: { in: 10, out: 9 },
  },
  {
    name: "OpenAI content filter",
    api: "openai",
    wire: [
      { type: "response.created", response: { id: "resp_2", model: "gpt-x" } },
      {
        type: "response.incomplete",
        response: {
          id: "resp_2",
          status: "incomplete",
          incomplete_details: { reason: "content_filter" },
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
    ],
    refusal: { category: "content_filter" },
    message: "Request refused: content_filter",
    usage: { in: 10, out: 0 },
  },
  {
    name: "Anthropic refusal before any output",
    api: "anthropic",
    wire: [
      anthropicStart,
      {
        type: "message_delta",
        delta: {
          stop_reason: "refusal",
          stop_sequence: null,
          stop_details: { type: "refusal", category: "cyber", explanation: EXPLANATION },
        },
        usage: { output_tokens: 0 },
      },
      { type: "message_stop" },
    ],
    refusal: { category: "cyber", text: EXPLANATION },
    message: EXPLANATION,
    usage: { in: 412, out: 0 },
  },
  {
    name: "Anthropic refusal after partial output",
    api: "anthropic",
    wire: [
      anthropicStart,
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello.." } },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: {
          stop_reason: "refusal",
          stop_sequence: null,
          stop_details: { type: "refusal", category: null, explanation: null },
        },
        usage: { output_tokens: 3 },
      },
      { type: "message_stop" },
    ],
    refusal: {},
    message: "Request refused",
    usage: { in: 412, out: 3 },
  },
  {
    name: "Chat Completions refusal text",
    api: "chat",
    wire: [
      {
        id: "c1",
        model: "gpt-x",
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: null, refusal: "I'm sorry, " },
            finish_reason: null,
          },
        ],
      },
      {
        id: "c1",
        model: "gpt-x",
        choices: [{ index: 0, delta: { refusal: "I can't help with that." }, finish_reason: null }],
      },
      { id: "c1", model: "gpt-x", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      { id: "c1", model: "gpt-x", choices: [], usage: { prompt_tokens: 10, completion_tokens: 9 } },
    ],
    refusal: { text: REFUSAL_TEXT },
    message: REFUSAL_TEXT,
    usage: { in: 10, out: 9 },
  },
  {
    name: "Chat Completions content filter",
    api: "chat",
    wire: [
      {
        id: "c2",
        model: "gpt-x",
        choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
      },
      {
        id: "c2",
        model: "gpt-x",
        choices: [{ index: 0, delta: {}, finish_reason: "content_filter" }],
      },
      { id: "c2", model: "gpt-x", choices: [], usage: { prompt_tokens: 10, completion_tokens: 0 } },
    ],
    refusal: { category: "content_filter" },
    message: "Request refused: content_filter",
    usage: { in: 10, out: 0 },
  },
  {
    name: "Gemini blocked prompt",
    api: "gemini",
    wire: [
      {
        responseId: "g1",
        modelVersion: "gemini-x",
        promptFeedback: { blockReason: "PROHIBITED_CONTENT", blockReasonMessage: "unsafe" },
        usageMetadata: { promptTokenCount: 10 },
      },
    ],
    refusal: { category: "PROHIBITED_CONTENT", text: "unsafe" },
    message: "unsafe",
    usage: { in: 10, out: 0 },
  },
  {
    name: "Gemini safety finish reason",
    api: "gemini",
    wire: [
      {
        responseId: "g2",
        modelVersion: "gemini-x",
        candidates: [{ finishReason: "SAFETY" }],
        usageMetadata: { promptTokenCount: 10, totalTokenCount: 10 },
      },
    ],
    refusal: { category: "SAFETY" },
    message: "Request refused: SAFETY",
    usage: { in: 10, out: 0 },
  },
];

async function* replay(wire: object[]) {
  yield* wire;
}

function toSSE(wire: object[]): string {
  return [...wire.map((chunk) => `data: ${JSON.stringify(chunk)}`), "data: [DONE]", ""].join(
    "\n\n",
  );
}

const sdkRequests = { openai, anthropic, gemini };

function harness(
  api: Api,
  wire: object[],
): { provider: AIProvider; roles(call: number): string[] } {
  if (api === "chat") {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(toSSE(wire)));
    vi.stubGlobal("fetch", fetchMock);
    return {
      provider: {
        name: api,
        createStreamingRequest: (model, params) =>
          chat({ ...params, model, baseUrl: "https://example.test", maxRetries: 0 }),
      },
      roles: (call) =>
        JSON.parse(fetchMock.mock.calls[call][1].body).messages.map(
          (message: { role: string }) => message.role,
        ),
    };
  }

  const invoke = vi.fn().mockImplementation(() => replay(wire));
  const clients = {
    openai: { responses: { stream: invoke } },
    anthropic: { messages: { create: invoke } },
    gemini: { models: { generateContentStream: invoke } },
  };
  const requestMessages = {
    openai: (call: number) => invoke.mock.calls[call][0].input,
    anthropic: (call: number) => invoke.mock.calls[call][0].messages,
    gemini: (call: number) => invoke.mock.calls[call][0].contents,
  };
  return {
    provider: {
      name: api,
      createStreamingRequest: (model, params) =>
        (sdkRequests[api] as (params: any) => ReturnType<typeof openai>)({
          ...params,
          model,
          client: clients[api],
        }),
    },
    roles: (call) => requestMessages[api](call).map((message: { role: string }) => message.role),
  };
}

const messages = [{ role: "user" as const, content: "first" }];

afterEach(() => vi.unstubAllGlobals());

describe.each(cases)("$name", ({ api, wire, refusal, message, usage }) => {
  test.each(["generate", "stream"])("%s returns a refusal failure", async (entry) => {
    const { provider } = harness(api, wire);
    const options = { provider, model: "test", messages };
    const result = await (entry === "generate" ? generate(options) : stream(options).final);

    expect(result).toMatchObject({ ok: false, messages: [], usage });
    expect(result.error).toEqual({ kind: "refusal", refusal, message });
  });

  test("stream ends with a refusal error event and no completed step", async () => {
    const { provider } = harness(api, wire);
    const events: StreamEvent[] = [];
    const handle = stream({ provider, model: "test", messages });
    handle.on((event) => events.push(event));
    await handle.final;

    expect(events.at(-1)).toEqual({ type: "error", error: { kind: "refusal", refusal, message } });
    expect(events.map((event) => event.type)).not.toContain("step:complete");
  });

  test("a follow-up request holds only the two user messages", async () => {
    const { provider, roles } = harness(api, wire);
    const refused = await generate({ provider, model: "test", messages });
    await generate({
      provider,
      model: "test",
      messages: [...messages, ...refused.messages, { role: "user", content: "second" }],
    });

    expect(roles(1)).toEqual(["user", "user"]);
  });
});

test("an Instruct call that is refused returns the refusal, not a parse failure", async () => {
  const { provider } = harness("openai", cases[0].wire);
  const result = await generate({
    provider,
    model: "test",
    instruct: new Instruct({ prompt: "Answer", schema: z.object({ answer: z.string() }) }),
  });

  expect(result).toMatchObject({
    ok: false,
    error: { kind: "refusal", refusal: { text: REFUSAL_TEXT } },
  });
});

test("Agent reports a refusal on the result and the turn, and can send again", async () => {
  const { provider, roles } = harness("anthropic", cases[2].wire);
  const agent = new Agent({ provider, model: "test" });

  const result = await agent.send("first").final;

  expect(result).toMatchObject({
    ok: false,
    error: { kind: "refusal", refusal: { category: "cyber", text: EXPLANATION } },
    turn: { status: "error", error: { type: "refusal", message: EXPLANATION } },
  });

  await agent.send("second").final;
  expect(roles(1)).toEqual(["user", "user"]);
});

test("OpenAI truncation at max_output_tokens completes with a length finish reason", async () => {
  const { provider } = harness("openai", [
    { type: "response.created", response: { id: "resp_3", model: "gpt-x" } },
    { type: "response.output_text.delta", item_id: "msg_1", content_index: 0, delta: "Once" },
    { type: "response.output_text.done", item_id: "msg_1", content_index: 0, text: "Once" },
    {
      type: "response.incomplete",
      response: {
        id: "resp_3",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        usage: { input_tokens: 15, output_tokens: 16 },
      },
    },
  ]);
  const result = await generate({ provider, model: "test", messages });

  expect(result).toMatchObject({
    ok: true,
    final: { finishReason: AxleStopReason.Length, content: [{ type: "text", text: "Once" }] },
    usage: { in: 15, out: 16 },
  });
});
