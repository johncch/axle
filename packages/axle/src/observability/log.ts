import { truncate } from "../utils/truncate.js";
import type { EventLevel, Span, SpanData, SpanEvent, TraceWriter } from "./types.js";

export interface LogEntry {
  level: EventLevel;
  message: string;
  fields?: Record<string, unknown>;
}

export type LogFn = (entry: LogEntry) => void;

/**
 * Projects a tracer's diagnostics into flat, correlated host log entries:
 * leveled messages emitted within a span, and every span's completion as a line
 * carrying its name, `type`, `spanId`, and `parentSpanId` — enough to
 * reconstruct the trace skeleton from the log stream alone. The full span tree
 * also reaches a real span exporter via a separate writer.
 */
export class LogWriter implements TraceWriter {
  constructor(private readonly log: LogFn) {}

  onSpanStart(): void {}

  onSpanEnd(span: SpanData): void {
    // The narrative (info) gets tool actions and the top-level run. The full
    // span tree (turns, stream wrapper, internal spans) is debug-depth.
    const level: EventLevel =
      span.status === "error"
        ? "error"
        : span.type === "tool" || span.type === "workflow"
          ? "info"
          : "debug";
    this.log({
      level,
      message: span.name,
      fields: {
        ...span.attributes,
        type: span.type,
        status: span.status,
        traceId: span.traceId,
        spanId: span.spanId,
        ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
        ...(span.endTime !== undefined
          ? { durationMs: Math.round(span.endTime - span.startTime) }
          : {}),
      },
    });
  }

  onEvent(span: SpanData, event: SpanEvent): void {
    this.log({
      level: event.level,
      message: event.name,
      fields: {
        traceId: span.traceId,
        spanId: span.spanId,
        name: span.name,
        ...event.attributes,
      },
    });
  }
}

export function logContent(span: Span | undefined, message: string, value: string): void {
  if (!value) return;
  const preview = truncate(value);
  span?.info(message, { text: preview });
  if (preview !== value) span?.debug(message, { text: value });
}
