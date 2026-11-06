export interface SseMessage {
  id?: string;
  event?: string;
  data: string;
}

export function encodeSse(message: SseMessage): string {
  const lines: string[] = [];
  if (message.id !== undefined) lines.push(`id: ${message.id}`);
  if (message.event !== undefined) lines.push(`event: ${message.event}`);
  for (const line of message.data.split("\n")) lines.push(`data: ${line}`);
  return `${lines.join("\n")}\n\n`;
}

/**
 * Parse a byte stream as Server-Sent Events. Field lines may be split
 * across chunks; `id` persists across messages as the protocol says.
 */
export async function* parseSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseMessage, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let id: string | undefined;
  let event: string | undefined;
  let data: string[] = [];
  const onAbort = (): void => void reader.cancel().catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });
  const lines: string[] = [];
  const takeLines = (): void => {
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      lines.push(buffer.slice(0, newline).replace(/\r$/, ""));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  };
  function* messagesFrom(): Generator<SseMessage, void, undefined> {
    for (const line of lines.splice(0)) {
      if (line === "") {
        if (data.length > 0) yield { id, event, data: data.join("\n") };
        event = undefined;
        data = [];
        continue;
      }
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon >= 0 ? line.slice(0, colon) : line;
      const value = colon >= 0 ? line.slice(colon + 1).replace(/^ /, "") : "";
      if (field === "id") id = value;
      else if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      takeLines();
      yield* messagesFrom();
    }
    buffer += decoder.decode();
    if (buffer !== "") buffer += "\n";
    takeLines();
    yield* messagesFrom();
    if (data.length > 0) yield { id, event, data: data.join("\n") };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

/**
 * Answer an HTTP request with entries as Server-Sent Events: each entry as
 * JSON in `data:` with its cursor in `id:`, so `Last-Event-ID` on the next
 * request names where the client stopped. Ends the iterable when the
 * request aborts or the client cancels the body; holds nothing else.
 */
export function toEventStreamResponse(
  entries: AsyncIterable<{ cursor: string }>,
  request?: Request,
): Response {
  const iterator = entries[Symbol.asyncIterator]();
  const stop = (): void => void iterator.return?.().catch(() => {});
  request?.signal.addEventListener("abort", stop, { once: true });
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(stream) {
      const next = await iterator.next();
      if (next.done) {
        stream.close();
        return;
      }
      const message = encodeSse({ id: next.value.cursor, data: JSON.stringify(next.value) });
      stream.enqueue(encoder.encode(message));
    },
    cancel: stop,
  });
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
