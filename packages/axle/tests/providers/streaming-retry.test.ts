import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AnyStreamChunk } from "../../src/messages/stream.js";
import { createStreamingRequest as anthropicStream } from "../../src/providers/anthropic/createStreamingRequest.js";
import { createStreamingRequest as geminiStream } from "../../src/providers/gemini/createStreamingRequest.js";
import { createStreamingRequest as openaiStream } from "../../src/providers/openai/createStreamingRequest.js";

// Each SDK retries the request phase of a stream (429, 5xx, connection
// errors) before the first byte, the same as a buffered call. These tests
// pin that so generate() keeps the reliability it had on the buffered path.

function rateLimited(): Response {
  return new Response(
    JSON.stringify({ error: { type: "rate_limit_error", message: "slow down" } }),
    {
      status: 429,
      headers: { "content-type": "application/json", "retry-after-ms": "1", "retry-after": "0" },
    },
  );
}

function sse(events: Array<{ event?: string; data: unknown }>): Response {
  const body = events
    .map(
      ({ event, data }) => `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(data)}\n\n`,
    )
    .join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function collect(source: AsyncGenerator<AnyStreamChunk, void, unknown>) {
  const chunks: AnyStreamChunk[] = [];
  for await (const chunk of source) chunks.push(chunk);
  return chunks;
}

function expectCompleted(chunks: AnyStreamChunk[]) {
  expect(chunks.find((chunk) => chunk.type === "error")).toBeUndefined();
  expect(chunks.at(-1)?.type).toBe("complete");
}

describe("streaming requests retry before the first byte", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("Anthropic", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(
        sse([
          {
            event: "message_start",
            data: {
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
          },
          {
            event: "content_block_start",
            data: {
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: "" },
            },
          },
          {
            event: "content_block_delta",
            data: {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "pong" },
            },
          },
          { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
          {
            event: "message_delta",
            data: {
              type: "message_delta",
              delta: { stop_reason: "end_turn", stop_sequence: null },
              usage: { output_tokens: 1 },
            },
          },
          { event: "message_stop", data: { type: "message_stop" } },
        ]),
      );
    const client = new Anthropic({ apiKey: "test", maxRetries: 1, fetch: fetchMock as any });

    const chunks = await collect(
      anthropicStream({
        client,
        model: "claude-haiku-4-5",
        messages: [{ role: "user", content: "ping" }],
        runtime: {},
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expectCompleted(chunks);
  });

  test("OpenAI Responses", async () => {
    const response = {
      id: "resp_1",
      object: "response",
      created_at: 1,
      model: "gpt-5.6-luna",
      status: "in_progress",
      output: [],
      output_text: "",
      error: null,
      incomplete_details: null,
      instructions: null,
      metadata: {},
      parallel_tool_calls: true,
      temperature: 1,
      tool_choice: "auto",
      tools: [],
      top_p: 1,
    };
    const item = {
      id: "msg_1",
      type: "message",
      role: "assistant",
      status: "in_progress",
      content: [],
    };
    const completedItem = {
      ...item,
      status: "completed",
      content: [{ type: "output_text", text: "pong", annotations: [] }],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(
        sse([
          {
            event: "response.created",
            data: { type: "response.created", sequence_number: 0, response },
          },
          {
            event: "response.output_item.added",
            data: { type: "response.output_item.added", sequence_number: 1, output_index: 0, item },
          },
          {
            event: "response.content_part.added",
            data: {
              type: "response.content_part.added",
              sequence_number: 2,
              item_id: "msg_1",
              output_index: 0,
              content_index: 0,
              part: { type: "output_text", text: "", annotations: [] },
            },
          },
          {
            event: "response.output_text.delta",
            data: {
              type: "response.output_text.delta",
              sequence_number: 2,
              item_id: "msg_1",
              output_index: 0,
              content_index: 0,
              delta: "pong",
              logprobs: [],
            },
          },
          {
            event: "response.output_item.done",
            data: {
              type: "response.output_item.done",
              sequence_number: 3,
              output_index: 0,
              item: completedItem,
            },
          },
          {
            event: "response.completed",
            data: {
              type: "response.completed",
              sequence_number: 4,
              response: {
                ...response,
                status: "completed",
                output: [completedItem],
                output_text: "pong",
                usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
              },
            },
          },
        ]),
      );
    const client = new OpenAI({ apiKey: "test", maxRetries: 1, fetch: fetchMock as any });

    const chunks = await collect(
      openaiStream({
        client,
        model: "gpt-5.6-luna",
        messages: [{ role: "user", content: "ping" }],
        runtime: {},
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expectCompleted(chunks);
  });

  test("Gemini", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(
        sse([
          {
            data: {
              responseId: "r1",
              modelVersion: "gemini-flash-lite-latest",
              candidates: [
                {
                  index: 0,
                  content: { role: "model", parts: [{ text: "pong" }] },
                  finishReason: "STOP",
                },
              ],
              usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1, totalTokenCount: 6 },
            },
          },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = new GoogleGenAI({
      apiKey: "test",
      httpOptions: { retryOptions: { attempts: 2, initialDelay: 0.001, maxDelay: 0.001 } },
    });

    const chunks = await collect(
      geminiStream({
        client,
        model: "gemini-flash-lite-latest",
        messages: [{ role: "user", content: "ping" }],
        runtime: {},
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expectCompleted(chunks);
  });
});
