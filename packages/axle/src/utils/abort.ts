import { AxleAbortError } from "../errors/AxleAbortError.js";
import type { TimeoutReason } from "../turns/types.js";

export function throwIfAborted(
  signal: AbortSignal | undefined,
  message = "Operation aborted",
): void {
  if (!signal?.aborted) return;
  throw new AxleAbortError(message, { reason: signal.reason });
}

export function raceWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  message = "Operation aborted",
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new AxleAbortError(message, { reason: signal.reason }));
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new AxleAbortError(message, { reason: signal.reason }));
    };

    signal.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export interface TimeoutSignal extends Disposable {
  /** Aborts with `{ type: "timeout", limitMs }` once `ms` pass without a `reset()`, or with the parent's reason when it aborts. */
  readonly signal: AbortSignal;
  /** Whether the timer, not the parent, aborted it. */
  readonly expired: boolean;
  /** Start the `ms` over from now. */
  reset(): void;
}

/**
 * A signal that follows `parent` and also aborts after `ms` with
 * `{ type: "timeout", limitMs: ms }`; dispose it to stop the timer. With no
 * `ms` there is no timer: the signal is the parent's and it never expires.
 */
export function timeoutSignal(
  parent: AbortSignal | undefined,
  ms: number | undefined,
): TimeoutSignal {
  if (ms === undefined) {
    return {
      signal: parent ?? new AbortController().signal,
      expired: false,
      reset() {},
      [Symbol.dispose]() {},
    };
  }
  const limitMs = ms;
  const controller = new AbortController();
  const reason: TimeoutReason = { type: "timeout", limitMs };
  const expire = (): void => controller.abort(reason);
  let timer = setTimeout(expire, limitMs);
  return {
    signal: parent ? AbortSignal.any([parent, controller.signal]) : controller.signal,
    get expired() {
      return controller.signal.aborted;
    },
    reset() {
      clearTimeout(timer);
      if (!controller.signal.aborted) timer = setTimeout(expire, limitMs);
    },
    [Symbol.dispose]() {
      clearTimeout(timer);
    },
  };
}
