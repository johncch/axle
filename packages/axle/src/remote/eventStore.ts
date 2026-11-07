import type { AgentStatus } from "../core/agent/types.js";
import type { AgentEvent, AgentStateEvent, TurnEvent } from "../turns/events.js";
import type { AgentSubscription, StreamItem } from "./protocol.js";

export type StoredEvent<THostEvent extends { type: string } = never> = (TurnEvent | THostEvent) & {
  cursor: string;
};

type Queued<THostEvent extends { type: string }> =
  | { kind: "event"; seq: number; event: StoredEvent<THostEvent> }
  | { kind: "state"; state: AgentStateEvent };

interface ServedAgent {
  readonly status: AgentStatus;
  on(callback: (event: AgentEvent) => void): () => void;
}

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
 * One served agent's events, kept in memory. Every agent event, and every
 * host event given to `push`, is stamped with a cursor `<id>-<seq>` in the
 * order it happened and kept. The agent's `state` events are neither: last
 * value wins. `subscribe` opens with the current state, replays what a
 * consumer has not seen and continues live with no gap and no repeat, state
 * changes in their place among the events. A host that keeps events in its
 * own store serves subscriptions from there instead.
 */
export class InMemoryEventStore<THostEvent extends { type: string } = never> {
  readonly id: string = crypto.randomUUID().slice(0, 8);
  private seq = 0;
  private events: Array<{ seq: number; event: StoredEvent<THostEvent> }> = [];
  private queues = new Set<EventQueue<Queued<THostEvent>>>();

  constructor(private readonly agent: ServedAgent) {
    agent.on((event) => {
      if (event.type === "state") {
        for (const queue of this.queues) queue.push({ kind: "state", state: event });
      } else {
        this.append(event);
      }
    });
  }

  /** Cursor of the last event; `<id>-0` before the first. */
  get lastCursor(): string {
    return `${this.id}-${this.seq}`;
  }

  /** Whether `cursor` names a position in this store, so a replay can continue from it. */
  owns(cursor: string | null | undefined): boolean {
    return typeof cursor === "string" && this.seqOf(cursor) !== undefined;
  }

  push(event: THostEvent): void {
    this.append(event);
  }

  /**
   * The agent's state now, then events after `after` when this store owns
   * it, else every event held, then live events and state changes until
   * `signal` aborts. Registered before the replay starts, so an event
   * appended during it is delivered once, in order.
   */
  subscribe(signal: AbortSignal, after?: string | null): AgentSubscription<THostEvent> {
    const queue = new EventQueue<Queued<THostEvent>>();
    this.queues.add(queue);
    const close = (): void => {
      this.queues.delete(queue);
      queue.close();
    };
    if (signal.aborted) close();
    signal.addEventListener("abort", close, { once: true });
    const afterSeq = this.seqOf(after ?? undefined) ?? 0;
    const replay = this.events.filter((held) => held.seq > afterSeq);
    const items: AsyncIterable<StreamItem<THostEvent>> = {
      async *[Symbol.asyncIterator]() {
        let last = afterSeq;
        try {
          for (const held of replay) {
            last = held.seq;
            yield held.event;
          }
          for await (const queued of queue.drain()) {
            if (queued.kind === "state") {
              yield queued.state;
              continue;
            }
            if (queued.seq <= last) continue;
            last = queued.seq;
            yield queued.event;
          }
        } finally {
          signal.removeEventListener("abort", close);
          close();
        }
      },
    };
    return { state: { type: "state", status: this.agent.status }, items };
  }

  private append(event: TurnEvent | THostEvent): void {
    const seq = ++this.seq;
    const held = { seq, event: { ...event, cursor: `${this.id}-${seq}` } };
    this.events.push(held);
    for (const queue of this.queues) queue.push({ kind: "event", ...held });
  }

  private seqOf(cursor: string | undefined): number | undefined {
    if (cursor === undefined || !cursor.startsWith(`${this.id}-`)) return undefined;
    const seq = Number(cursor.slice(this.id.length + 1));
    return Number.isInteger(seq) && seq >= 0 ? seq : undefined;
  }
}
