import { AxleAgentAbortError } from "../../errors/AxleAgentAbortError.js";
import { createStats } from "../../utils/stats.js";
import type { Handle } from "../../utils/utils.js";

interface ScheduledWork {
  execute(): Promise<void>;
  reject(reason?: unknown): void;
  steer: boolean;
  state: "queued" | "claimed" | "running" | "settled";
}

export class AgentScheduler {
  private current?: ScheduledWork;
  private normal: ScheduledWork[] = [];
  private steering: ScheduledWork[] = [];

  schedule<T>(
    run: (context: { signal: AbortSignal }) => Promise<T>,
    externalSignal?: AbortSignal,
    steer = false,
  ): Handle<T> {
    const abort = new AbortController();
    const signal = externalSignal ? AbortSignal.any([externalSignal, abort.signal]) : abort.signal;
    const { promise: final, resolve, reject } = Promise.withResolvers<T>();
    const item: ScheduledWork = {
      execute: async () => {
        try {
          resolve(await run({ signal }));
        } catch (error) {
          reject(error);
        }
      },
      reject,
      steer,
      state: "queued",
    };

    if (!this.current) {
      this.activate(item);
    } else if (steer) {
      this.steering.push(item);
    } else {
      this.normal.push(item);
    }

    const withdraw = () => {
      if (item.state === "queued" && this.removeQueued(item)) {
        item.state = "settled";
        reject(
          new AxleAgentAbortError("Agent send aborted", {
            reason: signal.reason,
            usage: createStats(),
          }),
        );
      }
    };
    signal.addEventListener("abort", withdraw, { once: true });
    if (signal.aborted) withdraw();

    return {
      cancel: (reason?: unknown) => abort.abort(reason),
      final,
    };
  }

  claimSteer(): boolean {
    const next = this.steering.find((item) => item.state === "queued");
    if (!next) return false;
    next.state = "claimed";
    return true;
  }

  private activate(item: ScheduledWork): void {
    if (item.state === "queued") item.state = "claimed";
    this.current = item;
    queueMicrotask(() => void this.run(item));
  }

  private async run(item: ScheduledWork): Promise<void> {
    item.state = "running";
    try {
      await item.execute();
    } finally {
      item.state = "settled";
      if (this.current !== item) return;
      this.current = undefined;
      const next = this.steering.shift() ?? this.normal.shift();
      if (next) this.activate(next);
    }
  }

  private removeQueued(item: ScheduledWork): boolean {
    const queue = item.steer ? this.steering : this.normal;
    const index = queue.indexOf(item);
    if (index < 0) return false;
    queue.splice(index, 1);
    return true;
  }
}
