import { AxleAgentAbortError } from "../../errors/AxleAgentAbortError.js";
import { AxleError } from "../../errors/AxleError.js";
import { createStats } from "../../utils/stats.js";
import type { Handle } from "../../utils/utils.js";

type TaskState = "queued" | "running" | "settling" | "continuing" | "settled";

type Work<T> = (context: { signal: AbortSignal }) => Promise<T>;
type Settle<T> = (result: PromiseSettledResult<T>) => void | Promise<void>;

/**
 * What a continuation runs inline turns through: each `run` executes its
 * work, then its settle step, one at a time in call order, under the
 * task's own signal.
 */
export interface InlineRunner {
  readonly signal: AbortSignal;
  run<U>(work: Work<U>, settle?: Settle<U>): Promise<U>;
}

type Continue<T> = (value: T, inline: InlineRunner) => Promise<T | void>;

class ScheduledTask<T> {
  readonly final: Promise<T>;
  state: TaskState = "queued";

  private readonly controller = new AbortController();
  private readonly resolveFinal: (value: T) => void;
  private readonly rejectFinal: (reason?: unknown) => void;
  private inlineTail: Promise<void> = Promise.resolve();
  private inlineOpen = false;

  constructor(
    private readonly scheduler: AgentScheduler,
    private readonly work: Work<T>,
    private readonly operation: string,
    private readonly externalSignal: AbortSignal | undefined,
    private readonly onWithdrawn: (() => void) | undefined,
    private readonly settle: Settle<T> | undefined,
    private readonly after: Continue<T> | undefined,
  ) {
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    // Marks `final` as handled so an unread handle raises no unhandled
    // rejection; readers still see it reject (agent-state.md, invariant 8).
    promise.catch(() => {});
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
    }
    this.state = "settling";
    try {
      await this.settle?.(result);
      if (this.after && result.status === "fulfilled") {
        result = this.controller.signal.aborted
          ? { status: "rejected", reason: this.abortError() }
          : await this.continue(result.value);
      }
    } finally {
      this.externalSignal?.removeEventListener("abort", this.onExternalAbort);
      this.state = "settled";
      if (result.status === "fulfilled") this.resolveFinal(result.value);
      else this.rejectFinal(result.reason);
    }
  }

  get remaining(): boolean {
    switch (this.state) {
      case "running":
      case "continuing":
        return true;
      case "settling":
        return this.after !== undefined && !this.controller.signal.aborted;
      default:
        return false;
    }
  }

  cancel(reason?: unknown): void {
    if (this.state === "settled") return;
    if (this.state === "settling" && !this.remaining) return;
    this.controller.abort(reason);
    if (this.scheduler.withdraw(this)) {
      this.state = "settled";
      this.externalSignal?.removeEventListener("abort", this.onExternalAbort);
      this.onWithdrawn?.();
      this.rejectFinal(this.abortError());
    }
  }

  private async continue(value: T): Promise<PromiseSettledResult<T>> {
    this.state = "continuing";
    this.inlineOpen = true;
    let result: PromiseSettledResult<T>;
    try {
      const replaced = await this.after!(value, this.inlineRunner());
      result = { status: "fulfilled", value: replaced === undefined ? value : replaced };
    } catch (reason) {
      result = { status: "rejected", reason };
    } finally {
      this.inlineOpen = false;
      await this.inlineTail;
    }
    if (this.controller.signal.aborted) {
      return { status: "rejected", reason: this.abortError() };
    }
    return result;
  }

  private inlineRunner(): InlineRunner {
    return {
      signal: this.controller.signal,
      run: <U>(work: Work<U>, settle?: Settle<U>): Promise<U> => {
        if (!this.inlineOpen) {
          return Promise.reject(
            new AxleError(`Agent ${this.operation} continuation has already returned`),
          );
        }
        const execution = this.inlineTail.then(async () => {
          let result: PromiseSettledResult<U>;
          try {
            result = { status: "fulfilled", value: await work({ signal: this.controller.signal }) };
          } catch (reason) {
            result = { status: "rejected", reason };
          }
          await settle?.(result);
          if (result.status === "fulfilled") return result.value;
          throw result.reason;
        });
        this.inlineTail = execution.then(
          () => {},
          () => {},
        );
        return execution;
      },
    };
  }

  private abortError(): AxleAgentAbortError {
    return new AxleAgentAbortError(`Agent ${this.operation} aborted`, {
      reason: this.controller.signal.reason,
      usage: createStats(),
    });
  }

  private onExternalAbort = (): void => this.cancel(this.externalSignal?.reason);
}

export class AgentScheduler {
  private current?: ScheduledTask<any>;
  private queue: ScheduledTask<any>[] = [];

  constructor(private readonly onIdle?: () => void) {}

  schedule<T>(
    work: Work<T>,
    options?: {
      signal?: AbortSignal;
      operation?: string;
      onWithdrawn?: () => void;
      settle?: Settle<T>;
      after?: Continue<T>;
    },
  ): Handle<T> {
    const task = new ScheduledTask(
      this,
      work,
      options?.operation ?? "send",
      options?.signal,
      options?.onWithdrawn,
      options?.settle,
      options?.after,
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
    if (!this.current?.remaining) return false;
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
