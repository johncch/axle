import { AxleAgentAbortError } from "../../errors/AxleAgentAbortError.js";
import { AxleError } from "../../errors/AxleError.js";
import { createStats } from "../../utils/stats.js";
import type { Handle } from "../../utils/utils.js";
import type { AgentStatus } from "./types.js";

type TaskState = "queued" | "starting" | "running" | "continuing" | "settling" | "settled";

export type OperationKind = "send" | "compaction";

type Work<T> = (context: { signal: AbortSignal }) => Promise<T>;
type Start = (signal: AbortSignal) => void | Promise<void>;
type Settle<T> = (result: PromiseSettledResult<T>) => void | Promise<void>;

/**
 * What a continuation runs inline turns through: each `run` executes its
 * work, one at a time in call order, under the task's own signal.
 */
export interface InlineRunner {
  readonly signal: AbortSignal;
  run<U>(work: Work<U>): Promise<U>;
}

/**
 * The scheduler's lifecycle points, called as they happen: `started` once
 * the operation holds the queue and `status` already reports it, `ended`
 * just before its handle settles, `idle` once `status` reports idle.
 */
export interface SchedulerLifecycle {
  started(id: string, kind: OperationKind): void;
  afterStarted(id: string): void;
  afterEnded(id: string): void;
  ended(id: string, result: PromiseSettledResult<unknown>): void;
  idle(): void;
}

type Continue<T> = (value: T, inline: InlineRunner) => Promise<T | void>;

const noLifecycle: SchedulerLifecycle = {
  started: () => {},
  afterStarted: () => {},
  afterEnded: () => {},
  ended: () => {},
  idle: () => {},
};

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
    readonly id: string,
    private readonly work: Work<T>,
    readonly kind: OperationKind,
    private readonly lifecycle: SchedulerLifecycle,
    private readonly externalSignal: AbortSignal | undefined,
    private readonly onWithdrawn: (() => void) | undefined,
    private readonly start: Start | undefined,
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
    let result: PromiseSettledResult<T>;
    try {
      this.state = "starting";
      await this.start?.(this.controller.signal);
      this.state = "running";
      result = { status: "fulfilled", value: await this.work({ signal: this.controller.signal }) };
    } catch (reason) {
      result = { status: "rejected", reason };
    }
    if (this.after && result.status === "fulfilled") {
      result = this.controller.signal.aborted
        ? { status: "rejected", reason: this.abortError() }
        : await this.continue(result.value);
    }
    this.state = "settling";
    try {
      await this.settle?.(result);
    } catch (reason) {
      result = { status: "rejected", reason };
    } finally {
      this.externalSignal?.removeEventListener("abort", this.onExternalAbort);
      this.state = "settled";
      this.lifecycle.ended(this.id, result);
      if (result.status === "fulfilled") this.resolveFinal(result.value);
      else this.rejectFinal(result.reason);
    }
  }

  get remaining(): boolean {
    switch (this.state) {
      case "starting":
      case "running":
      case "continuing":
        return true;
      default:
        return false;
    }
  }

  cancel(reason?: unknown): void {
    if (this.state === "settled" || this.state === "settling") return;
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
    this.lifecycle.afterStarted(this.id);
    let result: PromiseSettledResult<T>;
    try {
      const replaced = await this.after!(value, this.inlineRunner());
      result = { status: "fulfilled", value: replaced === undefined ? value : replaced };
    } catch (reason) {
      result = { status: "rejected", reason };
    } finally {
      this.inlineOpen = false;
      await this.inlineTail;
      this.lifecycle.afterEnded(this.id);
    }
    if (this.controller.signal.aborted) {
      return { status: "rejected", reason: this.abortError() };
    }
    return result;
  }

  private inlineRunner(): InlineRunner {
    return {
      signal: this.controller.signal,
      run: <U>(work: Work<U>): Promise<U> => {
        if (!this.inlineOpen) {
          return Promise.reject(
            new AxleError(`Agent ${this.label} continuation has already returned`),
          );
        }
        const execution = this.inlineTail.then(() => work({ signal: this.controller.signal }));
        this.inlineTail = execution.then(
          () => {},
          () => {},
        );
        return execution;
      },
    };
  }

  private get label(): string {
    return this.kind === "send" ? "send" : "compact";
  }

  private abortError(): AxleAgentAbortError {
    return new AxleAgentAbortError(`Agent ${this.label} aborted`, {
      reason: this.controller.signal.reason,
      usage: createStats(),
    });
  }

  private onExternalAbort = (): void => this.cancel(this.externalSignal?.reason);
}

export class AgentScheduler {
  private current?: ScheduledTask<any>;
  private queue: ScheduledTask<any>[] = [];

  constructor(private readonly lifecycle: SchedulerLifecycle = noLifecycle) {}

  schedule<T>(
    id: string,
    work: Work<T>,
    options?: {
      signal?: AbortSignal;
      kind?: OperationKind;
      onWithdrawn?: () => void;
      start?: Start;
      settle?: Settle<T>;
      after?: Continue<T>;
    },
  ): Handle<T> {
    const task = new ScheduledTask(
      this,
      id,
      work,
      options?.kind ?? "send",
      this.lifecycle,
      options?.signal,
      options?.onWithdrawn,
      options?.start,
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

  get status(): AgentStatus {
    return this.current ? { phase: "busy", id: this.current.id } : { phase: "idle" };
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
    this.lifecycle.started(task.id, task.kind);
    queueMicrotask(() => void this.run(task));
  }

  private async run(task: ScheduledTask<any>): Promise<void> {
    try {
      await task.execute();
    } finally {
      this.current = undefined;
      const next = this.queue.shift();
      if (next) this.activate(next);
      else this.lifecycle.idle();
    }
  }
}
