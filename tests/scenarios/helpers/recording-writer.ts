import type { SpanData, SpanStatus, TraceWriter } from "../../../src/tracer/types.js";
import { Tracer } from "../../../src/tracer/tracer.js";

export type LifecycleEvent =
  | { type: "span:start"; name: string; spanId: string; parentSpanId?: string; spanType?: string }
  | { type: "span:end"; name: string; spanId: string; status: SpanStatus }
  | { type: "span:update"; name: string; spanId: string };

export class RecordingWriter implements TraceWriter {
  timeline: LifecycleEvent[] = [];
  spans: Map<string, SpanData> = new Map();

  onSpanStart(span: SpanData): void {
    this.timeline.push({
      type: "span:start",
      name: span.name,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      spanType: span.type,
    });
  }

  onSpanEnd(span: SpanData): void {
    this.timeline.push({
      type: "span:end",
      name: span.name,
      spanId: span.spanId,
      status: span.status,
    });
    this.spans.set(span.spanId, structuredClone(span));
  }

  onSpanUpdate(span: SpanData): void {
    this.timeline.push({
      type: "span:update",
      name: span.name,
      spanId: span.spanId,
    });
  }

}

export function eventIndex(timeline: LifecycleEvent[], type: string, name: string): number {
  return timeline.findIndex((e) => e.type === type && e.name === name);
}

export function createTracerAndWriter() {
  const writer = new RecordingWriter();
  const tracer = new Tracer();
  tracer.addWriter(writer);
  return { writer, tracer };
}
