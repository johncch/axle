import { AxleAgentAbortError } from "../../errors/AxleAgentAbortError.js";
import { createStats } from "../../utils/stats.js";
import type { Handle } from "../../utils/utils.js";

type TaskState = "queued" | "running" | "settling" | "settled";

class ScheduledTask<T> {
  readonly final: Promise<T>;
  state: TaskState = "queued";

  private readonly controller = new AbortController();
  private readonly resolveFinal: (value: T) => void;
  private readonly rejectFinal: (reason?: unknown) => void;

  constructor(
    private readonly scheduler: AgentScheduler,
    private readonly work: (context: { signal: AbortSignal }) => Promise<T>,
    private readonly operation: string,
    private readonly externalSignal: AbortSignal | undefined,
    private readonly onWithdrawn: (() => void) | undefined,
    private readonly settle:
      ((result: PromiseSettledResult<T>) => void | Promise<void>) | undefined,
  ) {
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    this.final = promise;
    this.resolveFinal = resolve;
    this.rejectFinal = reject;
  }

  watchExternalSignal(): void {
    if (!this.externalSignal) return;
    if (this.externalSignal.aborted) {
      this.cancel(this.externalSignal.reason);
    } else {
      this.externalSignal.addEventListener("abort", this.onExternalAbort, { once: true });
    }
  }

  async execute(): Promise<void> {
    this.state = "running";
    let result: PromiseSettledResult<T>;
    try {
      result = { status: "fulfilled", value: await this.work({ signal: this.controller.signal }) };
    } catch (reason) {
      result = { status: "rejected", reason };
    } finally {
      this.externalSignal?.removeEventListener("abort", this.onExternalAbort);
    }
    this.state = "settling";
    try {
      await this.settle?.(result);
    } finally {
      this.state = "settled";
      if (result.status === "fulfilled") this.resolveFinal(result.value);
      else this.rejectFinal(result.reason);
    }
  }

  cancel(reason?: unknown): void {
    if (this.state === "settling" || this.state === "settled") return;
    this.controller.abort(reason);
    if (this.scheduler.withdraw(this)) {
      this.state = "settled";
      this.externalSignal?.removeEventListener("abort", this.onExternalAbort);
      this.onWithdrawn?.();
      this.rejectFinal(
        new AxleAgentAbortError(`Agent ${this.operation} aborted`, {
          reason: this.controller.signal.reason,
          usage: createStats(),
        }),
      );
    }
  }

  private onExternalAbort = (): void => this.cancel(this.externalSignal?.reason);
}

export class AgentScheduler {
  private current?: ScheduledTask<any>;
  private queue: ScheduledTask<any>[] = [];

  constructor(private readonly onIdle?: () => void) {}

  schedule<T>(
    work: (context: { signal: AbortSignal }) => Promise<T>,
    options?: {
      signal?: AbortSignal;
      operation?: string;
      onWithdrawn?: () => void;
      settle?: (result: PromiseSettledResult<T>) => void | Promise<void>;
    },
  ): Handle<T> {
    const task = new ScheduledTask(
      this,
      work,
      options?.operation ?? "send",
      options?.signal,
      options?.onWithdrawn,
      options?.settle,
    );

    if (!this.current) {
      this.activate(task);
    } else {
      this.queue.push(task);
    }
    task.watchExternalSignal();

    return { cancel: (reason?: unknown) => task.cancel(reason), final: task.final };
  }

  get idle(): boolean {
    return !this.current;
  }

  cancelCurrent(reason?: unknown): boolean {
    if (!this.current || this.current.state !== "running") return false;
    this.current.cancel(reason);
    return true;
  }

  clear(): number {
    const queued = [...this.queue];
    for (const task of queued) task.cancel();
    return queued.length;
  }

  withdraw(task: ScheduledTask<any>): boolean {
    const index = this.queue.indexOf(task);
    if (index < 0) return false;
    this.queue.splice(index, 1);
    return true;
  }

  private activate(task: ScheduledTask<any>): void {
    this.current = task;
    queueMicrotask(() => void this.run(task));
  }

  private async run(task: ScheduledTask<any>): Promise<void> {
    try {
      await task.execute();
    } finally {
      this.current = undefined;
      const next = this.queue.shift();
      if (next) this.activate(next);
      else this.onIdle?.();
    }
  }
}
