import type {
  EventLevel,
  SpanData,
  SpanEvent,
  SpanOptions,
  SpanResult,
  SpanStatus,
  TraceWriter,
  TracingContext,
} from "./types.js";

const levelOrder: Record<EventLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Root tracer that manages writers and creates spans.
 * Use startSpan() to create TracingContext instances for hierarchical tracing.
 * All logging happens within spans - the Tracer itself is just configuration and factory.
 */
export class Tracer {
  private writers: TraceWriter[] = [];
  private _minLevel: EventLevel = "info";

  get minLevel(): EventLevel {
    return this._minLevel;
  }

  set minLevel(level: EventLevel) {
    this._minLevel = level;
  }

  addWriter(writer: TraceWriter): void {
    if (!this.writers.includes(writer)) {
      this.writers.push(writer);
    }
  }

  removeWriter(writer: TraceWriter): void {
    const index = this.writers.indexOf(writer);
    if (index !== -1) {
      this.writers.splice(index, 1);
    }
  }

  startSpan(name: string, options?: SpanOptions): TracingContext {
    const spanData: SpanData = {
      traceId: crypto.randomUUID(),
      spanId: crypto.randomUUID(),
      name,
      type: options?.type,
      startTime: performance.now(),
      status: "ok",
      attributes: {},
      events: [],
    };

    this.writers.forEach((w) => w.onSpanStart(spanData));

    return new Span(spanData, this);
  }

  async flush(): Promise<void> {
    for (const writer of this.writers) {
      if (writer.flush) {
        await writer.flush();
      }
    }
  }

  // Internal methods for Span to call

  /** @internal */
  _notifySpanEnd(spanData: SpanData): void {
    this.writers.forEach((w) => w.onSpanEnd(spanData));
  }

  /** @internal */
  _notifySpanUpdate(spanData: SpanData): void {
    this.writers.forEach((w) => w.onSpanUpdate?.(spanData));
  }

  /** @internal */
  _notifyEvent(spanData: SpanData, event: SpanEvent): void {
    this.writers.forEach((w) => w.onEvent?.(spanData, event));
  }

  /** @internal */
  _notifySpanStart(spanData: SpanData): void {
    this.writers.forEach((w) => w.onSpanStart(spanData));
  }

  /** @internal */
  _shouldLog(level: EventLevel): boolean {
    return levelOrder[level] >= levelOrder[this._minLevel];
  }
}

/**
 * A span context that implements TracingContext.
 * Created by Tracer.startSpan() or Span.startSpan().
 */
class Span implements TracingContext {
  private data: SpanData;
  private tracer: Tracer;
  private ended = false;

  constructor(data: SpanData, tracer: Tracer) {
    this.data = data;
    this.tracer = tracer;
  }

  startSpan(name: string, options?: SpanOptions): TracingContext {
    const childData: SpanData = {
      traceId: this.data.traceId,
      spanId: crypto.randomUUID(),
      parentSpanId: this.data.spanId,
      name,
      type: options?.type,
      startTime: performance.now(),
      status: "ok",
      attributes: {},
      events: [],
    };

    this.tracer._notifySpanStart(childData);

    return new Span(childData, this.tracer);
  }

  end(status: SpanStatus = "ok"): void {
    if (this.ended) return;

    this.ended = true;
    this.data.endTime = performance.now();
    this.data.status = status;
    this.tracer._notifySpanEnd(this.data);
  }

  private addEvent(name: string, level: EventLevel, attributes?: Record<string, unknown>): void {
    if (this.ended) return;
    if (!this.tracer._shouldLog(level)) return;

    const event: SpanEvent = {
      name,
      timestamp: performance.now(),
      level,
      attributes,
    };

    this.data.events.push(event);
    this.tracer._notifyEvent(this.data, event);
  }

  debug(message: string, attributes?: Record<string, unknown>): void {
    this.addEvent(message, "debug", attributes);
  }

  info(message: string, attributes?: Record<string, unknown>): void {
    this.addEvent(message, "info", attributes);
  }

  warn(message: string, attributes?: Record<string, unknown>): void {
    this.addEvent(message, "warn", attributes);
  }

  error(message: string, attributes?: Record<string, unknown>): void {
    this.addEvent(message, "error", attributes);
  }

  setAttribute(key: string, value: unknown): void {
    if (this.ended) return;

    this.data.attributes[key] = value;
    this.tracer._notifySpanUpdate(this.data);
  }

  setAttributes(attributes: Record<string, unknown>): void {
    if (this.ended) return;

    Object.assign(this.data.attributes, attributes);
    this.tracer._notifySpanUpdate(this.data);
  }

  setResult(result: SpanResult): void {
    if (this.ended) return;

    this.data.result = result;
    this.tracer._notifySpanUpdate(this.data);
  }
}
