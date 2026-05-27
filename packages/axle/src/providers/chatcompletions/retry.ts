import { raceWithSignal, throwIfAborted } from "../../utils/abort.js";
import { requireInteger } from "../utils.js";

export interface ChatCompletionsRetryAttemptInfo {
  attempt: number;
  delayMs: number;
  error?: unknown;
  status?: number;
}

export interface ChatCompletionsRetryOptions {
  maxRetries?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onRetry?: (info: ChatCompletionsRetryAttemptInfo) => void;
}

export interface RetryOperationContext {
  signal?: AbortSignal;
}

export async function withRetry(
  operation: (context: RetryOperationContext) => Promise<Response>,
  options: ChatCompletionsRetryOptions = {},
): Promise<Response> {
  const maxRetries = requireInteger(options.maxRetries ?? 2, "maxRetries", { min: 0 });
  const timeoutMs =
    options.timeoutMs === undefined
      ? undefined
      : requireInteger(options.timeoutMs, "timeoutMs", { min: 1 });
  let attempt = 0;

  while (true) {
    throwIfAborted(options.signal, "Request aborted");
    const attemptSignal = createAttemptSignal(options.signal, timeoutMs);

    try {
      const response = await raceWithSignal(
        operation({ signal: attemptSignal.signal }),
        attemptSignal.signal,
        "Request aborted",
      );
      if (!isRetryableStatus(response.status) || attempt >= maxRetries) {
        return response;
      }

      const delayMs = getRetryDelayMs(response, attempt);
      options.onRetry?.({ attempt: attempt + 1, delayMs, status: response.status });
      await sleep(delayMs, options.signal);
      attempt += 1;
    } catch (error) {
      throwIfAborted(options.signal, "Request aborted");
      if (attempt >= maxRetries) {
        throw error;
      }

      const delayMs = getRetryDelayMs(undefined, attempt);
      options.onRetry?.({ attempt: attempt + 1, delayMs, error });
      await sleep(delayMs, options.signal);
      attempt += 1;
    } finally {
      attemptSignal.cleanup();
    }
  }
}

function createAttemptSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): { signal?: AbortSignal; cleanup: () => void } {
  if (timeoutMs === undefined) {
    return { signal, cleanup: () => {} };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new DOMException(`Request timed out after ${timeoutMs}ms`, "TimeoutError"));
  }, timeoutMs);

  const abort = () => {
    controller.abort(signal?.reason);
  };

  if (signal?.aborted) {
    abort();
  } else {
    signal?.addEventListener("abort", abort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    },
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function getRetryDelayMs(response: Response | undefined, attempt: number): number {
  const retryAfterMs = parseRetryAfterMs(response);
  if (retryAfterMs !== undefined) return retryAfterMs;

  const baseMs = Math.min(500 * 2 ** attempt, 8_000);
  const jitterMs = Math.floor(Math.random() * baseMs * 0.25);
  return baseMs + jitterMs;
}

function parseRetryAfterMs(response: Response | undefined): number | undefined {
  const retryAfterMs = response?.headers.get("retry-after-ms");
  if (retryAfterMs) {
    const parsed = Number.parseFloat(retryAfterMs);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }

  const retryAfter = response?.headers.get("retry-after");
  if (!retryAfter) return undefined;

  const seconds = Number.parseFloat(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;

  const dateMs = Date.parse(retryAfter);
  if (Number.isFinite(dateMs)) return Math.max(dateMs - Date.now(), 0);

  return undefined;
}

async function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) {
    throwIfAborted(signal, "Request aborted");
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Request aborted", "AbortError"));
    };
    const complete = () => {
      cleanup();
      resolve();
    };

    if (signal?.aborted) {
      abort();
      return;
    }

    timeout = setTimeout(complete, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
  throwIfAborted(signal, "Request aborted");
}
