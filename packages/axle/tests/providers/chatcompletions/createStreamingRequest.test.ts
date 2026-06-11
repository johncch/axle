import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import type { AnyStreamChunk } from "../../../src/messages/stream.js";
import { createStreamingRequest } from "../../../src/providers/chatcompletions/createStreamingRequest.js";
import { stream } from "../../../src/providers/stream.js";
import type { AIProvider } from "../../../src/providers/types.js";
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
      `data: ${JSON.stringify({ id: "c-1", model: MODEL, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 3, cache_write_tokens: 4 }, completion_tokens_details: { reasoning_tokens: 2 } } })}`,
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
        runtime: {},
        maxRetries: 0,
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
    expect((complete as any).data.usage).toEqual({
      in: 5,
      out: 10,
      cachedIn: 3,
      cacheWriteIn: 4,
      reasoningOut: 2,
    });
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
        runtime: {},
      }),
    );

    // Should not throw or emit errors
    const errors = chunks.filter((c) => c.type === "error");
    expect(errors).toHaveLength(0);
  });

  test("skips a single malformed SSE data line and completes valid chunks", async () => {
    const span = makeSpan();
    const sseLines = [
      "data: {this is not json}",
      "",
      `data: ${JSON.stringify({ id: "c-1", model: MODEL, choices: [{ index: 0, delta: { role: "assistant", content: "Recovered" }, finish_reason: null }] })}`,
      "",
      `data: ${JSON.stringify({ id: "c-1", model: MODEL, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      "",
    ];

    (fetch as any).mockResolvedValue(makeSSEResponse(sseLines.join("\n")));

    const chunks = await collectChunks(
      createStreamingRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: { span },
        maxRetries: 0,
      }),
    );

    expect(span.error).toHaveBeenCalledWith(
      "Error parsing ChatCompletions stream chunk",
      expect.objectContaining({ line: "data: {this is not json}" }),
    );
    expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
    expect(chunks.find((chunk) => chunk.type === "text-delta")).toMatchObject({
      type: "text-delta",
      data: { text: "Recovered" },
    });
    expect(chunks.find((chunk) => chunk.type === "complete")).toMatchObject({
      type: "complete",
      data: { finishReason: AxleStopReason.Stop },
    });
  });

  test("surfaces upstream SSE error frames through stream() as model errors", async () => {
    const sseLines = [
      `data: ${JSON.stringify({
        id: "c-1",
        object: "chat.completion.chunk",
        model: MODEL,
        error: { code: "server_error", message: "Provider disconnected unexpectedly" },
        choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }],
      })}`,
      "",
    ];

    (fetch as any).mockResolvedValue(makeSSEResponse(sseLines.join("\n")));

    const handle = stream({
      provider: makeProvider(),
      model: MODEL,
      messages: [{ role: "user", content: "Hi" }],
    });

    const result = await handle.final;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("model");
      if (result.error.kind !== "model") throw new Error("Expected model error");
      expect(result.error.error).toMatchObject({
        type: "error",
        error: {
          type: "server_error",
          message: "Provider disconnected unexpectedly",
        },
      });
    }
  });

  test("surfaces truncated tool-call arguments through stream() with the tool name", async () => {
    const sseLines = [
      `data: ${JSON.stringify({
        id: "c-1",
        model: MODEL,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  function: { name: "search", arguments: '{"query":' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      })}`,
      "",
    ];

    (fetch as any).mockResolvedValue(makeSSEResponse(sseLines.join("\n")));

    const handle = stream({
      provider: makeProvider(),
      model: MODEL,
      messages: [{ role: "user", content: "Hi" }],
    });

    const result = await handle.final;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("model");
      if (result.error.kind !== "model") throw new Error("Expected model error");
      expect(result.error.error).toMatchObject({
        type: "error",
        error: {
          type: "IncompleteStream",
        },
      });
      expect(result.error.error.error.message).toContain("search");
      expect(result.error.error.error.message).toContain("truncated or incomplete");
    }
  });

  test("surfaces adapter errors instead of dropping the stream chunk", async () => {
    const sseLines = [
      `data: ${JSON.stringify({
        id: "c-1",
        model: MODEL,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  function: { name: "search", arguments: '{"query":' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      })}`,
      "",
      `data: ${JSON.stringify({
        id: "c-1",
        model: MODEL,
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      })}`,
      "",
    ];

    (fetch as any).mockResolvedValue(makeSSEResponse(sseLines.join("\n")));

    const chunks = await collectChunks(
      createStreamingRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
        maxRetries: 0,
      }),
    );

    expect(chunks.at(-1)).toMatchObject({
      type: "error",
      data: {
        type: "STREAMING_ERROR",
      },
    });
    expect((chunks.at(-1) as any).data.message).toContain(
      "Failed to parse tool call arguments for search",
    );
  });

  test("continues after a tool returns an unsupported binary file", async () => {
    const toolCallSse = [
      `data: ${JSON.stringify({
        id: "c-1",
        model: MODEL,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  function: { name: "capture_image", arguments: "{}" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      })}`,
      "",
      `data: ${JSON.stringify({
        id: "c-1",
        model: MODEL,
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      })}`,
      "",
    ];
    const finalSse = [
      `data: ${JSON.stringify({
        id: "c-2",
        model: MODEL,
        choices: [{ index: 0, delta: { content: "Attachment unavailable" }, finish_reason: null }],
      })}`,
      "",
      `data: ${JSON.stringify({
        id: "c-2",
        model: MODEL,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      })}`,
      "",
    ];
    (fetch as any)
      .mockResolvedValueOnce(makeSSEResponse(toolCallSse.join("\n")))
      .mockResolvedValueOnce(makeSSEResponse(finalSse.join("\n")));

    const handle = stream({
      provider: makeProvider(),
      model: MODEL,
      messages: [{ role: "user", content: "Capture an image." }],
      onToolCall: async () => ({
        type: "success",
        content: [
          { type: "text", text: "Captured image:" },
          {
            type: "file",
            file: {
              kind: "image",
              mimeType: "image/png",
              name: "capture.png",
              source: { type: "base64", data: "iVBORw0KGgo=" },
            },
          },
        ],
      }),
    });

    const result = await handle.final;

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse((fetch as any).mock.calls[1][1].body);
    expect(secondBody.messages.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "call_1",
    });
    expect(secondBody.messages.at(-1).content).toContain("Captured image:");
    expect(secondBody.messages.at(-1).content).toContain("Tool result attachment unavailable.");
    expect(secondBody.messages.at(-1).content).toContain("File: capture.png");
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
        runtime: {},
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
        runtime: {},
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
        runtime: {},
        maxRetries: 0,
      }),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("error");
    expect((chunks[0] as any).data.message).toContain("Connection refused");
  });

  test("retries fetch setup failures before reading the stream", async () => {
    vi.useFakeTimers();
    const sseLines = [
      `data: ${JSON.stringify({ id: "c-1", model: MODEL, choices: [{ index: 0, delta: { content: "Recovered" }, finish_reason: null }] })}`,
      "",
      `data: ${JSON.stringify({ id: "c-1", model: MODEL, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      "",
    ];
    (fetch as any)
      .mockRejectedValueOnce(new Error("Connection refused"))
      .mockResolvedValueOnce(makeSSEResponse(sseLines.join("\n")));

    const pending = collectChunks(
      createStreamingRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
        maxRetries: 1,
      }),
    );

    await vi.runAllTimersAsync();
    const chunks = await pending;

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
    expect(chunks.some((chunk) => chunk.type === "text-delta")).toBe(true);
    vi.useRealTimers();
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
        runtime: {},
      }),
    );

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  test("drops provider tools and warns without a provider tool vendor", async () => {
    const span = makeSpan();
    const sseLines = [
      `data: ${JSON.stringify({ id: "c-1", model: MODEL, choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }] })}`,
      "",
      `data: ${JSON.stringify({ id: "c-1", model: MODEL, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      "",
    ];
    (fetch as any).mockResolvedValue(makeSSEResponse(sseLines.join("\n")));

    await collectChunks(
      createStreamingRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: { span },
        providerTools: [{ type: "provider", name: "web_search" }],
      }),
    );

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.tools).toBeUndefined();
    expect(span.warn).toHaveBeenCalledWith(
      "providerTools not supported by ChatCompletions provider",
    );
  });

  test("maps OpenRouter provider tools and keeps function tools", async () => {
    const sseLines = [
      `data: ${JSON.stringify({ id: "c-1", model: MODEL, choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }] })}`,
      "",
      `data: ${JSON.stringify({ id: "c-1", model: MODEL, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      "",
    ];
    (fetch as any).mockResolvedValue(makeSSEResponse(sseLines.join("\n")));

    await collectChunks(
      createStreamingRequest({
        baseUrl: BASE_URL,
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        runtime: {},
        providerToolVendor: "openrouter",
        tools: [{ name: "lookup", description: "Lookup", schema: z.object({ q: z.string() }) }],
        providerTools: [{ type: "provider", name: "web_search", config: { max_results: 3 } }],
      }),
    );

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.tools).toHaveLength(2);
    expect(body.tools[0]).toMatchObject({
      type: "function",
      function: { name: "lookup" },
    });
    expect(body.tools[1]).toEqual({
      type: "openrouter:web_search",
      parameters: { max_results: 3 },
    });
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

function makeSpan() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as any;
}

function makeProvider(): AIProvider {
  return {
    name: "chatcompletions-test",
    async createGenerationRequest() {
      throw new Error("Not implemented");
    },
    createStreamingRequest(_model, params) {
      return createStreamingRequest({
        ...params,
        baseUrl: BASE_URL,
        model: _model,
        maxRetries: 0,
      });
    },
  };
}
