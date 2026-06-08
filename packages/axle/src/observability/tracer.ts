import type {
  EventLevel,
  Span,
  SpanData,
  SpanEvent,
  SpanOptions,
  SpanResult,
  SpanStatus,
  TraceWriter,
} from "./types.js";

const levelOrder: Record<EventLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

// Epoch ms via the monotonic clock, so durations still subtract exactly.
const now = (): number => performance.timeOrigin + performance.now();

// Spans hold a Recorder, not the Tracer, so the Tracer's public surface carries
// no dispatch callbacks.
class Recorder {
  readonly writers: TraceWriter[] = [];
  minLevel: EventLevel = "info";

  addWriter(writer: TraceWriter): void {
    if (!this.writers.includes(writer)) this.writers.push(writer);
  }

  removeWriter(writer: TraceWriter): void {
    const index = this.writers.indexOf(writer);
    if (index !== -1) this.writers.splice(index, 1);
  }

  shouldLog(level: EventLevel): boolean {
    return levelOrder[level] >= levelOrder[this.minLevel];
  }

  spanStart(span: SpanData): void {
    for (const w of this.writers) w.onSpanStart(span);
  }

  spanEnd(span: SpanData): void {
    for (const w of this.writers) w.onSpanEnd(span);
  }

  spanUpdate(span: SpanData): void {
    for (const w of this.writers) w.onSpanUpdate?.(span);
  }

  event(span: SpanData, event: SpanEvent): void {
    for (const w of this.writers) w.onEvent?.(span, event);
  }

  async flush(): Promise<void> {
    for (const w of this.writers) {
      if (w.flush) await w.flush();
    }
  }
}

export interface TracerOptions {
  minLevel?: EventLevel;
  writers?: TraceWriter[];
}

export class Tracer {
  private rec = new Recorder();

  constructor(options?: TracerOptions) {
    if (options?.minLevel) this.rec.minLevel = options.minLevel;
    for (const writer of options?.writers ?? []) this.rec.addWriter(writer);
  }

  get minLevel(): EventLevel {
    return this.rec.minLevel;
  }

  set minLevel(level: EventLevel) {
    this.rec.minLevel = level;
  }

  addWriter(writer: TraceWriter): void {
    this.rec.addWriter(writer);
  }

  removeWriter(writer: TraceWriter): void {
    this.rec.removeWriter(writer);
  }

  startSpan(name: string, options?: SpanOptions): Span {
    const spanData: SpanData = {
      traceId: crypto.randomUUID(),
      spanId: crypto.randomUUID(),
      name,
      type: options?.type,
      startTime: now(),
      status: "ok",
      attributes: { ...(options?.attributes ?? {}) },
      events: [],
    };

    this.rec.spanStart(spanData);

    return new SpanImpl(spanData, this.rec);
  }

  flush(): Promise<void> {
    return this.rec.flush();
  }
}

class SpanImpl implements Span {
  private data: SpanData;
  private rec: Recorder;
  private ended = false;

  constructor(data: SpanData, rec: Recorder) {
    this.data = data;
    this.rec = rec;
  }

  startSpan(name: string, options?: SpanOptions): Span {
    const childData: SpanData = {
      traceId: this.data.traceId,
      spanId: crypto.randomUUID(),
      parentSpanId: this.data.spanId,
      name,
      type: options?.type,
      startTime: now(),
      status: "ok",
      attributes: { ...(options?.attributes ?? {}) },
      events: [],
    };

    this.rec.spanStart(childData);

    return new SpanImpl(childData, this.rec);
  }

  end(status: SpanStatus = "ok"): void {
    if (this.ended) return;

    this.ended = true;
    this.data.endTime = now();
    this.data.status = status;
    this.rec.spanEnd(this.data);
  }

  private addEvent(name: string, level: EventLevel, attributes?: Record<string, unknown>): void {
    if (this.ended) return;
    if (!this.rec.shouldLog(level)) return;

    const event: SpanEvent = {
      name,
      timestamp: now(),
      level,
      attributes,
    };

    this.data.events.push(event);
    this.rec.event(this.data, event);
  }

  trace(message: string, attributes?: Record<string, unknown>): void {
    this.addEvent(message, "trace", attributes);
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
    this.rec.spanUpdate(this.data);
  }

  setAttributes(attributes: Record<string, unknown>): void {
    if (this.ended) return;

    Object.assign(this.data.attributes, attributes);
    this.rec.spanUpdate(this.data);
  }

  setResult(result: SpanResult): void {
    if (this.ended) return;

    this.data.result = result;
    this.rec.spanUpdate(this.data);
  }
}
