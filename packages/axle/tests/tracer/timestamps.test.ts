import { describe, expect, test } from "vitest";
import { Tracer } from "../../src/observability/tracer.js";
import type { SpanData } from "../../src/observability/types.js";

describe("Tracer timestamps", () => {
  test("spans carry epoch-millisecond timestamps with exact durations", () => {
    let ended: SpanData | undefined;
    const tracer = new Tracer({
      writers: [{ onSpanStart: () => {}, onSpanEnd: (span) => (ended = span) }],
    });

    const span = tracer.startSpan("work");
    span.end();

    // Epoch ms, not monotonic ms-since-process-start. A reverted `now()` using
    // performance.now() would be far below this (process uptime, ~1e7-1e8).
    expect(ended!.startTime).toBeGreaterThan(1_700_000_000_000);
    expect(ended!.endTime!).toBeGreaterThanOrEqual(ended!.startTime);
    expect(ended!.endTime! - ended!.startTime).toBeLessThan(1000);
  });
});
