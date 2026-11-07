import type { AgentStatus } from "../core/agent/types.js";
import type { AgentEvent, AgentStateEvent, TurnEvent } from "../turns/events.js";
import type { AgentSubscription, StreamItem } from "./protocol.js";

export type LoggedEvent<THostEvent extends { type: string } = never> = (TurnEvent | THostEvent) & {
  cursor: string;
};

type Queued<THostEvent extends { type: string }> =
  | { kind: "entry"; seq: number; entry: LoggedEvent<THostEvent> }
  | { kind: "state"; state: AgentStateEvent };

interface ServedAgent {
  readonly status: AgentStatus;
  on(callback: (event: AgentEvent) => void): () => void;
}

export interface EventLogOptions {
  /**
   * `all` keeps every entry for replay, the default. `none` keeps nothing:
   * for a host that forwards entries to its own store and replays from
   * there.
   */
  retain?: "all" | "none";
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
 * The numbered stream of one served agent. Every agent event, and every
 * host event given to `push`, is stamped with a cursor `<id>-<seq>` in the
 * order it happened and, by default, kept. The agent's `state` events are
 * neither: last value wins. `subscribe` opens with the current state,
 * replays what a consumer has not seen and continues live with no gap and
 * no repeat, state changes in their place among the entries. The stamp is
 * the only thing a transport needs to resume; the host decides how long
 * entries are kept and where.
 */
export class EventLog<THostEvent extends { type: string } = never> {
  readonly id: string = crypto.randomUUID().slice(0, 8);
  private seq = 0;
  private readonly retain: "all" | "none";
  private entries: Array<{ seq: number; entry: LoggedEvent<THostEvent> }> = [];
  private queues = new Set<EventQueue<Queued<THostEvent>>>();

  constructor(
    private readonly agent: ServedAgent,
    options: EventLogOptions = {},
  ) {
    this.retain = options.retain ?? "all";
    agent.on((event) => {
      if (event.type === "state") {
        for (const queue of this.queues) queue.push({ kind: "state", state: event });
      } else {
        this.append(event);
      }
    });
  }

  /** Cursor of the last entry; `<id>-0` before the first. */
  get lastCursor(): string {
    return `${this.id}-${this.seq}`;
  }

  /** Whether `cursor` names a position in this log, so a replay can continue from it. */
  owns(cursor: string | null | undefined): boolean {
    return typeof cursor === "string" && this.seqOf(cursor) !== undefined;
  }

  push(event: THostEvent): void {
    this.append(event);
  }

  /**
   * The agent's state now, then entries after `after` when this log owns
   * it, else every entry held, then live entries and state changes until
   * `signal` aborts. Registered before the replay starts, so an entry
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
    const replay = this.entries.filter((held) => held.seq > afterSeq);
    const items: AsyncIterable<StreamItem<THostEvent>> = {
      async *[Symbol.asyncIterator]() {
        let last = afterSeq;
        try {
          for (const held of replay) {
            last = held.seq;
            yield held.entry;
          }
          for await (const queued of queue.drain()) {
            if (queued.kind === "state") {
              yield queued.state;
              continue;
            }
            if (queued.seq <= last) continue;
            last = queued.seq;
            yield queued.entry;
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
    const held = { seq, entry: { ...event, cursor: `${this.id}-${seq}` } };
    if (this.retain === "all") this.entries.push(held);
    for (const queue of this.queues) queue.push({ kind: "entry", ...held });
  }

  private seqOf(cursor: string | undefined): number | undefined {
    if (cursor === undefined || !cursor.startsWith(`${this.id}-`)) return undefined;
    const seq = Number(cursor.slice(this.id.length + 1));
    return Number.isInteger(seq) && seq >= 0 ? seq : undefined;
  }
}
