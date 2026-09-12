import OpenAI from "openai";
import { type Mock, beforeEach, describe, expect, test, vi } from "vitest";
import z from "zod";
import type { AnyStreamChunk } from "../../../src/messages/stream.js";
import { createStreamingRequest } from "../../../src/providers/openai/createStreamingRequest.js";

const MODEL = "gpt-5.4-mini";
const response = {
  id: "resp_1",
  model: MODEL,
  status: "completed",
  object: "response",
  created_at: 1,
};
const item = { id: "msg_1", type: "message", role: "assistant", status: "completed", content: [] };

async function* events() {
  yield { type: "response.created", response };
  yield { type: "response.output_item.added", output_index: 0, item };
  yield {
    type: "response.content_part.added",
    item_id: "msg_1",
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text: "" },
  };
  yield {
    type: "response.output_text.delta",
    item_id: "msg_1",
    output_index: 0,
    content_index: 0,
    delta: "Hello",
  };
  yield { type: "response.output_item.done", output_index: 0, item };
  yield {
    type: "response.completed",
    response: { ...response, usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 } },
  };
}

async function drain(source: AsyncGenerator<AnyStreamChunk, void, unknown>) {
  const chunks: AnyStreamChunk[] = [];
  for await (const chunk of source) chunks.push(chunk);
  return chunks;
}

describe("createStreamingRequest (OpenAI Responses)", () => {
  let mockClient: OpenAI;
  let mockStream: Mock;
  const messages = [{ role: "user" as const, content: "Hello" }];

  beforeEach(() => {
    mockStream = vi.fn().mockImplementation(() => events()) as any;
    mockClient = { responses: { stream: mockStream } } as any;
  });

  const request = () => mockStream.mock.calls[0][0];

  test("passes the signal to the SDK and streams", async () => {
    const controller = new AbortController();
    const chunks = await drain(
      createStreamingRequest({
        client: mockClient,
        model: MODEL,
        messages,
        runtime: {},
        signal: controller.signal,
      }),
    );
    expect(mockStream).toHaveBeenCalledWith(expect.objectContaining({ stream: true }), {
      signal: controller.signal,
    });
    expect(chunks.at(-1)?.type).toBe("complete");
  });

  test("maps normalized options and lets providerOptions override", async () => {
    await drain(
      createStreamingRequest({
        client: mockClient,
        model: MODEL,
        messages,
        runtime: {},
        reasoning: "on",
        temperature: 0.5,
        topP: 0.9,
        maxOutputTokens: 100,
        providerOptions: { max_output_tokens: 200, reasoning: { effort: "medium" } },
      }),
    );
    expect(request()).toMatchObject({
      temperature: 0.5,
      top_p: 0.9,
      max_output_tokens: 200,
      reasoning: { effort: "medium" },
    });
  });

  test("maps named function and provider tool choices", async () => {
    await drain(
      createStreamingRequest({
        client: mockClient,
        model: MODEL,
        messages,
        runtime: {},
        tools: [{ name: "lookup", description: "Lookup", schema: z.object({ q: z.string() }) }],
        providerTools: [{ type: "provider", name: "web_search" }],
        toolChoice: { type: "tool", name: "web_search" },
        parallelToolCalls: true,
      }),
    );
    expect(request()).toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({ type: "function", name: "lookup" }),
        expect.objectContaining({ type: "web_search_preview" }),
      ]),
      tool_choice: { type: "web_search_preview" },
      parallel_tool_calls: true,
    });
  });

  test("serializes a finalized provider tool without resolving its name again", async () => {
    await drain(
      createStreamingRequest({
        client: mockClient,
        model: MODEL,
        messages,
        runtime: {},
        providerTools: [
          { type: "provider", name: "web_search", nativeName: "resolved_web_search" },
        ],
        toolChoice: { type: "tool", name: "web_search" },
      }),
    );
    expect(request()).toMatchObject({
      tools: [expect.objectContaining({ type: "resolved_web_search" })],
      tool_choice: { type: "resolved_web_search" },
    });
  });

  test("yields an error for normalized stop sequences", async () => {
    await expect(
      drain(
        createStreamingRequest({
          client: mockClient,
          model: MODEL,
          messages,
          runtime: {},
          stop: "STOP",
        }),
      ),
    ).resolves.toMatchObject([
      {
        type: "error",
        data: {
          type: "Error",
          message: "OpenAI Responses does not support normalized stop sequences",
        },
      },
    ]);
    expect(mockStream).not.toHaveBeenCalled();
  });
});
