import { AxleAbortError } from "../../errors/AxleAbortError.js";
import { AxleAgentAbortError } from "../../errors/AxleAgentAbortError.js";
import { LogWriter } from "../../observability/log.js";
import { Tracer } from "../../observability/tracer.js";
import type { Span, SpanStatus } from "../../observability/types.js";
import type { ObservabilityOptions } from "./types.js";

export interface ResolvedObservability {
  parent?: Tracer | Span;
  // Set only when Axle created the tracer — so only Axle flushes it.
  owned?: Tracer;
}

// `owned` stays unset when the caller brought `trace`: Axle attaches its spans
// but never ends or flushes a tracer/span you passed in.
export function resolveObservability(observability?: ObservabilityOptions): ResolvedObservability {
  if (!observability) return {};
  const { trace, log, level } = observability;

  if (trace) {
    if (log) {
      console.warn(
        "[axle] observability.log is ignored when observability.trace is set; add a LogWriter to your tracer's writers instead",
      );
    }
    return { parent: trace };
  }
  if (log) {
    const tracer = new Tracer({ minLevel: level, writers: [new LogWriter(log)] });
    return { parent: tracer, owned: tracer };
  }
  return {};
}

export function spanStatusFromError(error: unknown): SpanStatus {
  return isAbortLike(error) ? "cancelled" : "error";
}

function isAbortLike(error: unknown): boolean {
  return (
    error instanceof AxleAbortError ||
    error instanceof AxleAgentAbortError ||
    (error instanceof Error && error.name === "AbortError")
  );
}
