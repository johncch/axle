import type { TurnEvent } from "../turns/events.js";

export type LoggedEvent<THostEvent extends { type: string } = never> = (TurnEvent | THostEvent) & {
  cursor: string;
};

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
 * order it happened and, by default, kept. `subscribe` replays what a
 * consumer has not seen and continues live with no gap and no repeat. The
 * stamp is the only thing a transport needs to resume; the host decides how
 * long entries are kept and where.
 */
export class EventLog<THostEvent extends { type: string } = never> {
  readonly id: string = crypto.randomUUID().slice(0, 8);
  private seq = 0;
  private readonly retain: "all" | "none";
  private entries: Array<{ seq: number; entry: LoggedEvent<THostEvent> }> = [];
  private queues = new Set<EventQueue<{ seq: number; entry: LoggedEvent<THostEvent> }>>();

  constructor(
    agent: { on(callback: (event: TurnEvent) => void): () => void },
    options: EventLogOptions = {},
  ) {
    this.retain = options.retain ?? "all";
    agent.on((event) => this.append(event));
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
   * Entries after `after` when this log owns it, else every entry held,
   * then live entries until `signal` aborts. Registered before the replay
   * starts, so an entry appended during it is delivered once, in order.
   */
  subscribe(signal: AbortSignal, after?: string | null): AsyncIterable<LoggedEvent<THostEvent>> {
    const queue = new EventQueue<{ seq: number; entry: LoggedEvent<THostEvent> }>();
    this.queues.add(queue);
    const close = (): void => {
      this.queues.delete(queue);
      queue.close();
    };
    if (signal.aborted) close();
    signal.addEventListener("abort", close, { once: true });
    const afterSeq = this.seqOf(after ?? undefined) ?? 0;
    const replay = this.entries.filter((held) => held.seq > afterSeq);
    return {
      async *[Symbol.asyncIterator]() {
        let last = afterSeq;
        try {
          for (const held of replay) {
            last = held.seq;
            yield held.entry;
          }
          for await (const held of queue.drain()) {
            if (held.seq <= last) continue;
            last = held.seq;
            yield held.entry;
          }
        } finally {
          signal.removeEventListener("abort", close);
          close();
        }
      },
    };
  }

  private append(event: TurnEvent | THostEvent): void {
    const seq = ++this.seq;
    const held = { seq, entry: { ...event, cursor: `${this.id}-${seq}` } };
    if (this.retain === "all") this.entries.push(held);
    for (const queue of this.queues) queue.push(held);
  }

  private seqOf(cursor: string | undefined): number | undefined {
    if (cursor === undefined || !cursor.startsWith(`${this.id}-`)) return undefined;
    const seq = Number(cursor.slice(this.id.length + 1));
    return Number.isInteger(seq) && seq >= 0 ? seq : undefined;
  }
}
