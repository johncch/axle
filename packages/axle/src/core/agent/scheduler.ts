import { AxleAgentAbortError } from "../../errors/AxleAgentAbortError.js";
import { createStats } from "../../utils/stats.js";
import type { Handle } from "../../utils/utils.js";

class ScheduledTask<T> {
  readonly final: Promise<T>;

  private readonly controller = new AbortController();
  private readonly resolveFinal: (value: T) => void;
  private readonly rejectFinal: (reason?: unknown) => void;

  constructor(
    private readonly scheduler: AgentScheduler,
    private readonly work: (context: { signal: AbortSignal }) => Promise<T>,
    private readonly operation: string,
    private readonly externalSignal: AbortSignal | undefined,
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
    try {
      this.resolveFinal(await this.work({ signal: this.controller.signal }));
    } catch (error) {
      this.rejectFinal(error);
    } finally {
      this.externalSignal?.removeEventListener("abort", this.onExternalAbort);
    }
  }

  cancel(reason?: unknown): void {
    this.controller.abort(reason);
    if (this.scheduler.withdraw(this)) {
      this.externalSignal?.removeEventListener("abort", this.onExternalAbort);
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

  schedule<T>(
    work: (context: { signal: AbortSignal }) => Promise<T>,
    options?: { signal?: AbortSignal; operation?: string },
  ): Handle<T> {
    const task = new ScheduledTask(this, work, options?.operation ?? "send", options?.signal);

    if (!this.current) {
      this.activate(task);
    } else {
      this.queue.push(task);
    }
    task.watchExternalSignal();

    return { cancel: (reason?: unknown) => task.cancel(reason), final: task.final };
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
    }
  }
}
