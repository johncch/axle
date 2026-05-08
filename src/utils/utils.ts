export function arrayify<T>(arr: T | T[]): T[] {
  return Array.isArray(arr) ? arr : [arr];
}

export function stringify(obj: any): string {
  return typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
}

export function friendly(id: string, name?: string): string {
  if (name) {
    return `${name}:${id.slice(0, 8)}`;
  }
  return id.slice(0, 8);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Await a promise for sequencing without propagating its result or rejection */
export function settleWhen(promise: Promise<unknown>): Promise<void> {
  return promise.then(
    () => {},
    () => {},
  );
}

export interface Handle<T> {
  cancel(reason?: unknown): void;
  readonly final: Promise<T>;
}

/**
 * Creates a cancellable, queued async handle.
 * Waits for `queue` before running `work`, merges an optional external signal
 * with an internal abort controller, and returns the handle + settled promise
 * for queue chaining.
 */
export function createHandle<T>(
  queue: Promise<void>,
  work: (signal: AbortSignal) => Promise<T>,
  externalSignal?: AbortSignal,
): { handle: Handle<T>; settled: Promise<void> } {
  const abort = new AbortController();
  const signal = externalSignal ? AbortSignal.any([externalSignal, abort.signal]) : abort.signal;

  const finalPromise = queue.then(() => work(signal));
  const settled = settleWhen(finalPromise);

  return {
    handle: {
      cancel: (reason?: unknown) => abort.abort(reason),
      get final() {
        return finalPromise;
      },
    },
    settled,
  };
}
