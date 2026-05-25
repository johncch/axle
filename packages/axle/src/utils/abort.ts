import { AxleAbortError } from "../errors/AxleAbortError.js";

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
