import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AnyStreamChunk } from "../../../src/messages/stream.js";
import { createStreamingRequest } from "../../../src/providers/chatcompletions/createStreamingRequest.js";
import { AxleStopReason } from "../../../src/providers/types.js";

const BASE_URL = "http://localhost:11434/v1";
const MODEL = "gemma3";

describe("createStreamingRequest", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("parses SSE data lines into stream chunks", async () => {
    const sseLines = [
      `data: ${JSON.stringify({ id: "c-1", model: MODEL, choices: [{ index: 0, delta: { role: "assistant", content: "Hello" }, finish_reason: null }] })}`,
      "",
      `data: ${JSON.stringify({ id: "c-1", model: MODEL, choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }] })}`,
      "",
      `data: ${JSON.stringify({ id: "c-1", model: MODEL, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 10 } })}`,
      "",
      "data: [DONE]",
      "",
    ];

    (fetch as any).mockResolvedValue(makeSSEResponse(sseLines.join("\n")));

    const chunks = await collectChunks(
      createStreamingRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        context: {},
      }),
    );

    const types = chunks.map((c) => c.type);
    expect(types).toContain("start");
    expect(types).toContain("text-delta");
    expect(types).toContain("complete");

    const textChunks = chunks.filter((c) => c.type === "text-delta");
    expect(textChunks).toHaveLength(2);
    expect((textChunks[0] as any).data.text).toBe("Hello");
    expect((textChunks[1] as any).data.text).toBe(" world");

    const complete = chunks.find((c) => c.type === "complete");
    expect((complete as any).data.finishReason).toBe(AxleStopReason.Stop);
    expect((complete as any).data.usage).toEqual({ in: 5, out: 10 });
  });

  test("handles data: [DONE] gracefully", async () => {
    const sseLines = [
      `data: ${JSON.stringify({ id: "c-1", model: MODEL, choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }] })}`,
      "",
      `data: ${JSON.stringify({ id: "c-1", model: MODEL, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      "",
      "data: [DONE]",
      "",
    ];

    (fetch as any).mockResolvedValue(makeSSEResponse(sseLines.join("\n")));

    const chunks = await collectChunks(
      createStreamingRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        context: {},
      }),
    );

    // Should not throw or emit errors
    const errors = chunks.filter((c) => c.type === "error");
    expect(errors).toHaveLength(0);
  });

  test("ignores SSE comment lines (starting with :)", async () => {
    const sseLines = [
      ": this is a comment",
      `data: ${JSON.stringify({ id: "c-1", model: MODEL, choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }] })}`,
      "",
      `data: ${JSON.stringify({ id: "c-1", model: MODEL, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      "",
      "data: [DONE]",
      "",
    ];

    (fetch as any).mockResolvedValue(makeSSEResponse(sseLines.join("\n")));

    const chunks = await collectChunks(
      createStreamingRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        context: {},
      }),
    );

    const errors = chunks.filter((c) => c.type === "error");
    expect(errors).toHaveLength(0);
  });

  test("yields error chunk on HTTP failure", async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Server error"),
    });

    const chunks = await collectChunks(
      createStreamingRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        context: {},
      }),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("error");
    expect((chunks[0] as any).data.message).toContain("500");
  });

  test("yields error chunk on network failure", async () => {
    (fetch as any).mockRejectedValue(new Error("Connection refused"));

    const chunks = await collectChunks(
      createStreamingRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        context: {},
      }),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("error");
    expect((chunks[0] as any).data.message).toContain("Connection refused");
  });

  test("includes stream: true and stream_options in request body", async () => {
    const sseLines = [
      `data: ${JSON.stringify({ id: "c-1", model: MODEL, choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }] })}`,
      "",
      `data: ${JSON.stringify({ id: "c-1", model: MODEL, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      "",
      "data: [DONE]",
      "",
    ];
    (fetch as any).mockResolvedValue(makeSSEResponse(sseLines.join("\n")));

    await collectChunks(
      createStreamingRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        context: {},
      }),
    );

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });
});

// Helpers

async function collectChunks(gen: AsyncGenerator<AnyStreamChunk>): Promise<AnyStreamChunk[]> {
  const chunks: AnyStreamChunk[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
}

function makeSSEResponse(sseText: string) {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(sseText);

  let position = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (position >= encoded.length) {
        controller.close();
        return;
      }
      // Send in small chunks to simulate streaming
      const end = Math.min(position + 256, encoded.length);
      controller.enqueue(encoded.slice(position, end));
      position = end;
    },
  });

  return {
    ok: true,
    status: 200,
    body: stream,
    text: () => Promise.resolve(sseText),
  };
}
