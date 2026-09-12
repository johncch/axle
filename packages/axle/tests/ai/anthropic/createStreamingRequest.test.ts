import Anthropic from "@anthropic-ai/sdk";
import { type Mock, beforeEach, describe, expect, test, vi } from "vitest";
import type { AxleMessage } from "../../../src/messages/message.js";
import type { AnyStreamChunk } from "../../../src/messages/stream.js";
import { createStreamingRequest } from "../../../src/providers/anthropic/createStreamingRequest.js";

const textEvents = [
  {
    type: "message_start",
    message: {
      id: "msg_1",
      type: "message",
      role: "assistant",
      content: [],
      model: "claude-haiku-4-5",
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 5, output_tokens: 0 },
    },
  },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
  { type: "content_block_stop", index: 0 },
  {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 1 },
  },
  { type: "message_stop" },
];

async function* events() {
  for (const event of textEvents) yield event;
}

async function drain(source: AsyncGenerator<AnyStreamChunk, void, unknown>) {
  const chunks: AnyStreamChunk[] = [];
  for await (const chunk of source) chunks.push(chunk);
  return chunks;
}

describe("createStreamingRequest (Anthropic)", () => {
  let mockClient: Anthropic;
  let mockCreate: Mock;
  const messages: AxleMessage[] = [{ role: "user", content: "Hello" }];

  beforeEach(() => {
    mockCreate = vi.fn().mockResolvedValue(events()) as any;
    mockClient = { messages: { create: mockCreate } } as any;
  });

  const request = () => mockCreate.mock.calls[0][0];

  test("passes the signal to the SDK and streams", async () => {
    const controller = new AbortController();
    const chunks = await drain(
      createStreamingRequest({
        client: mockClient,
        model: "claude-haiku-4-5",
        messages,
        runtime: {},
        signal: controller.signal,
      }),
    );
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ stream: true }), {
      signal: controller.signal,
    });
    expect(chunks.at(-1)?.type).toBe("complete");
  });

  test("converts stop to stop_sequences", async () => {
    await drain(
      createStreamingRequest({
        client: mockClient,
        model: "claude-haiku-4-5",
        messages,
        runtime: {},
        stop: "STOP",
      }),
    );
    expect(request()).toMatchObject({ stop_sequences: ["STOP"] });
    expect(request()).not.toHaveProperty("stop");

    mockCreate.mockResolvedValue(events());
    await drain(
      createStreamingRequest({
        client: mockClient,
        model: "claude-haiku-4-5",
        messages,
        runtime: {},
        stop: ["A", "B"],
      }),
    );
    expect(mockCreate.mock.calls[1][0]).toMatchObject({ stop_sequences: ["A", "B"] });
  });

  test("maps normalized options, passes providerOptions through, and includes system", async () => {
    await drain(
      createStreamingRequest({
        client: mockClient,
        model: "claude-haiku-4-5",
        messages,
        system: "You are a helpful assistant",
        runtime: {},
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 1000,
        providerOptions: { metadata: { user_id: "u1" } },
      }),
    );
    expect(request()).toMatchObject({
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 1000,
      metadata: { user_id: "u1" },
      system: "You are a helpful assistant",
    });
  });

  test("adaptive thinking with effort on Opus 4.8", async () => {
    await drain(
      createStreamingRequest({
        client: mockClient,
        model: "claude-opus-4-8",
        messages,
        runtime: {},
        reasoning: { effort: "high" },
      }),
    );
    expect(request()).toMatchObject({
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "high" },
    });
    expect(request().thinking).not.toHaveProperty("budget_tokens");
  });

  test("legacy budget route defaults max_tokens to the model's registry ceiling", async () => {
    await drain(
      createStreamingRequest({
        client: mockClient,
        model: "claude-haiku-4-5",
        messages,
        runtime: {},
        reasoning: { effort: "high" },
      }),
    );
    expect(request()).toMatchObject({
      thinking: { type: "enabled", budget_tokens: 16384, display: "summarized" },
      max_tokens: 64000,
    });
  });

  test("providerOptions override the portable reasoning mapping", async () => {
    await drain(
      createStreamingRequest({
        client: mockClient,
        model: "claude-opus-4-8",
        messages,
        runtime: {},
        reasoning: "off",
        providerOptions: { thinking: { type: "adaptive" }, output_config: { effort: "max" } },
      }),
    );
    expect(request()).toMatchObject({
      thinking: { type: "adaptive" },
      output_config: { effort: "max" },
    });
  });

  test("echoes summarized, hidden, and redacted thinking parts as the blocks Anthropic sent", async () => {
    const history: AxleMessage[] = [
      { role: "user", content: "Question" },
      {
        role: "assistant",
        id: "msg_prev",
        content: [
          {
            type: "thinking",
            summary: "Gist.",
            continuity: { provider: "anthropic", signature: "sig-1" },
          },
          { type: "thinking", continuity: { provider: "anthropic", signature: "sig-2" } },
          {
            type: "thinking",
            redacted: true,
            continuity: { provider: "anthropic", redactedData: "opaque" },
          },
          { type: "text", text: "Answer" },
        ],
      },
      { role: "user", content: "Follow-up" },
    ];
    await drain(
      createStreamingRequest({
        client: mockClient,
        model: "claude-opus-5",
        messages: history,
        runtime: {},
      }),
    );
    expect(request().messages[1].content.slice(0, 3)).toEqual([
      { type: "thinking", thinking: "Gist.", signature: "sig-1" },
      { type: "thinking", thinking: "", signature: "sig-2" },
      { type: "redacted_thinking", data: "opaque" },
    ]);
  });
});
