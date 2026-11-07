import type { AgentStateEvent } from "../turns/events.js";
import { isStateEvent, type AgentSubscription } from "./protocol.js";

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
 * across chunks; `id` persists across messages, and a message the stream
 * ended inside is not delivered, as the protocol says.
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
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

/**
 * Answer an HTTP request with a subscription as Server-Sent Events: the
 * state first as `event: state`, then each event as JSON in `data:` with
 * its cursor in `id:`, so `Last-Event-ID` on the next request names where
 * the client stopped, and each state change as `event: state` with no
 * `id`, which leaves that position alone. Ends the items when the request
 * aborts or the client cancels the body; holds nothing else.
 */
export function toEventStreamResponse<THostEvent extends { type: string }>(
  subscription: AgentSubscription<THostEvent>,
  request?: Request,
): Response {
  const iterator = subscription.items[Symbol.asyncIterator]();
  const stop = (): void => void iterator.return?.().catch(() => {});
  request?.signal.addEventListener("abort", stop, { once: true });
  const encoder = new TextEncoder();
  const stateMessage = (state: AgentStateEvent): string =>
    encodeSse({ event: "state", data: JSON.stringify(state) });
  const body = new ReadableStream<Uint8Array>({
    start(stream) {
      stream.enqueue(encoder.encode(stateMessage(subscription.state)));
    },
    async pull(stream) {
      const next = await iterator.next();
      if (next.done) {
        stream.close();
        return;
      }
      const item = next.value;
      const message = isStateEvent(item)
        ? stateMessage(item)
        : encodeSse({ id: item.cursor, data: JSON.stringify(item) });
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
