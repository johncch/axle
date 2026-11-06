import type { Agent } from "../core/agent/Agent.js";
import type { TurnEvent } from "../turns/events.js";
import { encodeSse } from "./sse.js";

class EventQueue<T> {
  private items: T[] = [];
  private wake: (() => void) | undefined;
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    this.items.push(item);
    this.wake?.();
  }

  close(): void {
    this.closed = true;
    this.wake?.();
  }

  async *drain(): AsyncGenerator<T, void, undefined> {
    while (true) {
      const next = this.items.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
      this.wake = undefined;
    }
  }
}

/**
 * The agent's events from now until `signal` aborts, as an async iterable.
 * The subscription to `agent.on` is made in this call, so nothing emitted
 * after it is missed; nothing before it is replayed, and nothing is kept
 * once the consumer has taken it.
 */
export function agentEvents(
  agent: Pick<Agent, "on">,
  signal: AbortSignal,
): AsyncIterable<TurnEvent & { cursor: string }> {
  const queue = new EventQueue<TurnEvent & { cursor: string }>();
  const unsubscribe = agent.on((event) => queue.push(event));
  const close = (): void => {
    unsubscribe();
    queue.close();
  };
  if (signal.aborted) close();
  signal.addEventListener("abort", close, { once: true });
  return {
    async *[Symbol.asyncIterator]() {
      try {
        yield* queue.drain();
      } finally {
        signal.removeEventListener("abort", close);
        close();
      }
    },
  };
}

/**
 * Answer an HTTP request with the agent's events as Server-Sent Events: one
 * message per event, the event as JSON in `data:` and its cursor in `id:`.
 * The response subscribes when it is created and unsubscribes when the
 * request aborts or the body is cancelled; it holds nothing else.
 */
export function eventResponse(agent: Pick<Agent, "on">, request?: Request): Response {
  const controller = new AbortController();
  request?.signal.addEventListener("abort", () => controller.abort(), { once: true });
  const encoder = new TextEncoder();
  const events = agentEvents(agent, controller.signal)[Symbol.asyncIterator]();
  const body = new ReadableStream<Uint8Array>({
    async pull(stream) {
      const next = await events.next();
      if (next.done) {
        stream.close();
        return;
      }
      const message = encodeSse({ id: next.value.cursor, data: JSON.stringify(next.value) });
      stream.enqueue(encoder.encode(message));
    },
    cancel() {
      controller.abort();
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
