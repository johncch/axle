import { describe, expect, test } from "vitest";
import { encodeSse, parseSse, type SseMessage } from "../../src/remote/sse.js";

function bytes(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<SseMessage[]> {
  const messages: SseMessage[] = [];
  for await (const message of parseSse(stream)) messages.push(message);
  return messages;
}

describe("sse codec", () => {
  test("encodes id and data, splitting multi-line data across data lines", () => {
    expect(encodeSse({ id: "a-1", data: '{"x":1}' })).toBe('id: a-1\ndata: {"x":1}\n\n');
    expect(encodeSse({ data: "one\ntwo" })).toBe("data: one\ndata: two\n\n");
  });

  test("round-trips a sequence of encoded messages", async () => {
    const encoded = [
      encodeSse({ id: "a-1", data: '{"type":"turn:start"}' }),
      encodeSse({ id: "a-2", event: "note", data: "two\nlines" }),
    ].join("");

    expect(await collect(bytes([encoded]))).toEqual([
      { id: "a-1", event: undefined, data: '{"type":"turn:start"}' },
      { id: "a-2", event: "note", data: "two\nlines" },
    ]);
  });

  test("parses across chunk boundaries, CRLF and comment lines", async () => {
    const chunks = ["id: a-1\r\nda", "ta: hel", "lo\r\n\r\n: keepalive\n\ndata: w", "orld\n\n"];

    expect(await collect(bytes(chunks))).toEqual([
      { id: "a-1", event: undefined, data: "hello" },
      { id: "a-1", event: undefined, data: "world" },
    ]);
  });

  test("yields a trailing message that the stream closed without a blank line", async () => {
    expect(await collect(bytes(["data: last"]))).toEqual([
      { id: undefined, event: undefined, data: "last" },
    ]);
  });
});
