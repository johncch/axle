import type { AgentStateEvent } from "../turns/events.js";
import type { LoggedEvent } from "./eventLog.js";
import {
  isStateEvent,
  type AgentTransport,
  type CommandOutcome,
  type StreamItem,
} from "./protocol.js";
import { parseSse, type SseMessage } from "./sse.js";

export interface HttpTransportOptions {
  /** Cursor to resume from on the first connection, such as a stored `Turn.cursor`. */
  after?: string;
  /** Headers sent with every request; a function is called for each request. */
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  /** Wait before the first reconnect of a dropped event stream, in milliseconds. Default 1000. */
  reconnectDelayMs?: number;
  /** Ceiling on the wait, which doubles on each failed reconnect. Default 30000. */
  maxReconnectDelayMs?: number;
  fetch?: typeof fetch;
}

export class HttpTransportError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpTransportError";
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * An `AgentTransport` over HTTP to one URL: `GET` opens the event stream as
 * Server-Sent Events, `POST` sends a command as JSON and reads the outcome
 * back. A dropped stream is reopened with `Last-Event-ID` set to the last
 * cursor delivered, so the served side's log fills the gap. Reconnecting
 * retries a network failure or a `5xx` until the signal aborts, since the
 * served side may be mid-deploy, waiting `reconnectDelayMs` and doubling up
 * to `maxReconnectDelayMs`; a `404` or `410` ends the events, as the agent
 * is gone, and any other failed response fails the connection.
 */
export function httpTransport<THostEvent extends { type: string } = never>(
  url: string | URL,
  options: HttpTransportOptions = {},
): AgentTransport<THostEvent> {
  const fetchImpl = options.fetch ?? fetch;
  const reconnectDelayMs = options.reconnectDelayMs ?? 1000;
  const maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30_000;

  async function headersWith(extra: Record<string, string>): Promise<Headers> {
    const base = typeof options.headers === "function" ? await options.headers() : options.headers;
    const headers = new Headers(base);
    for (const [name, value] of Object.entries(extra)) headers.set(name, value);
    return headers;
  }

  async function open(after: string | undefined, signal: AbortSignal): Promise<Response> {
    const headers = await headersWith({ accept: "text/event-stream" });
    if (after !== undefined) headers.set("last-event-id", after);
    return fetchImpl(url, { method: "GET", headers, signal });
  }

  function bodyOf(response: Response): ReadableStream<Uint8Array> {
    if (!response.ok || response.body === null) {
      throw new HttpTransportError(
        response.status,
        `Event stream request failed: ${response.status}`,
      );
    }
    return response.body;
  }

  async function reopen(
    after: string | undefined,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array> | undefined> {
    let delay = reconnectDelayMs;
    while (true) {
      await sleep(delay, signal);
      if (signal.aborted) return undefined;
      delay = Math.min(delay * 2, maxReconnectDelayMs);
      let response: Response;
      try {
        response = await open(after, signal);
      } catch (error) {
        if (signal.aborted) return undefined;
        continue;
      }
      if (response.status === 404 || response.status === 410) return undefined;
      if (response.status >= 500) continue;
      return bodyOf(response);
    }
  }

  async function* itemsFrom(
    first: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): AsyncGenerator<StreamItem<THostEvent>, void, undefined> {
    let body: ReadableStream<Uint8Array> | undefined = first;
    let last = options.after;
    while (body !== undefined) {
      const messages = parseSse(body, signal);
      try {
        while (true) {
          let next: IteratorResult<SseMessage, void>;
          try {
            next = await messages.next();
          } catch (error) {
            if (signal.aborted) return;
            break;
          }
          if (next.done) break;
          if (next.value.event === "state") {
            const state: AgentStateEvent = JSON.parse(next.value.data);
            yield state;
            continue;
          }
          const entry: LoggedEvent<THostEvent> = JSON.parse(next.value.data);
          last = entry.cursor;
          yield entry;
        }
      } finally {
        await messages.return();
      }
      if (signal.aborted) return;
      body = await reopen(last, signal);
    }
  }

  return {
    async events(signal) {
      const response = await open(options.after, signal);
      const items = itemsFrom(bodyOf(response), signal);
      const first = await items.next();
      if (first.done || !isStateEvent(first.value)) {
        await items.return();
        throw new HttpTransportError(response.status, "Event stream did not open with a state");
      }
      return { state: first.value, items: { [Symbol.asyncIterator]: () => items } };
    },
    async command(command, signal) {
      const headers = await headersWith({ "content-type": "application/json" });
      const response = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(command),
        signal,
      });
      if (!response.ok) {
        throw new HttpTransportError(
          response.status,
          `Command ${command.type} failed: ${response.status}`,
        );
      }
      const outcome: CommandOutcome = await response.json();
      return outcome;
    },
  };
}
