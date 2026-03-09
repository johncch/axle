import type { AgentStreamEvent } from "../core/Agent.js";
import type { StreamResult } from "../providers/helpers.js";
import type { StreamHandle } from "../providers/stream.js";
import { Channel } from "./channel.js";
import type { SeqEvent, SessionStore } from "./store.js";
import { MemorySessionStore } from "./store.js";

export type SessionStatus = "idle" | "running" | "completed" | "error";

export class StreamSession {
  readonly id: string;
  private _status: SessionStatus = "idle";
  private seq = 0;
  private store: SessionStore;
  private channels = new Set<Channel<SeqEvent>>();
  private resolveResult!: (result: StreamResult) => void;
  private rejectResult!: (error: unknown) => void;
  readonly final: Promise<StreamResult>;

  constructor(store?: SessionStore) {
    this.id = crypto.randomUUID();
    this.store = store ?? new MemorySessionStore();
    this.final = new Promise<StreamResult>((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });
  }

  get status(): SessionStatus {
    return this._status;
  }

  push(event: AgentStreamEvent): void {
    if (this._status === "completed" || this._status === "error") return;
    if (this._status === "idle") this._status = "running";
    const entry: SeqEvent = { seq: ++this.seq, event };
    this.store.append(this.id, entry);
    for (const ch of this.channels) ch.push(entry);
  }

  close(): void {
    if (this._status === "completed" || this._status === "error") return;
    this._status = "completed";
    for (const ch of this.channels) ch.close();
    this.resolveResult({
      result: "success",
      messages: [],
      usage: { in: 0, out: 0 },
    });
  }

  attach(handle: StreamHandle): void {
    if (this._status !== "idle") {
      throw new Error("StreamSession can only be attached when idle");
    }
    this._status = "running";

    handle.on((event) => {
      const entry: SeqEvent = { seq: ++this.seq, event };
      this.store.append(this.id, entry);
      for (const ch of this.channels) ch.push(entry);
    });

    handle.final.then(
      (result) => {
        this._status = result.result === "error" ? "error" : "completed";
        this.store.setResult(this.id, result);
        for (const ch of this.channels) ch.close();
        this.resolveResult(result);
      },
      (err) => {
        this._status = "error";
        const result: StreamResult = {
          result: "error",
          messages: [],
          error: {
            type: "model",
            error: {
              type: "error",
              error: {
                type: "SessionError",
                message: err instanceof Error ? err.message : String(err),
              },
            },
          },
          usage: { in: 0, out: 0 },
        };
        this.store.setResult(this.id, result);
        for (const ch of this.channels) ch.close();
        this.resolveResult(result);
      },
    );
  }

  async *subscribe(afterSeq?: number): AsyncGenerator<SeqEvent, void, undefined> {
    // 1. Snapshot replay (synchronous read)
    const replay = this.store.read(this.id, afterSeq);
    // 2. Register channel (synchronous — no events can arrive between 1 and 2)
    const channel = new Channel<SeqEvent>();
    this.channels.add(channel);
    // 3. Yield replayed events
    for (const entry of replay) yield entry;
    // 4. If already done, clean up and return
    if (this._status === "completed" || this._status === "error") {
      this.channels.delete(channel);
      channel.close();
      return;
    }
    // 5. Tail from live channel
    try {
      for await (const entry of channel) yield entry;
    } finally {
      this.channels.delete(channel);
    }
  }
}
