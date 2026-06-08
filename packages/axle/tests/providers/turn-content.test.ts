import { describe, expect, test } from "vitest";
import type { ContentPart } from "../../src/messages/message.js";
import { Tracer } from "../../src/observability/tracer.js";
import type { SpanEvent } from "../../src/observability/types.js";
import { logTurnContent } from "../../src/providers/helpers.js";

function captureEvents() {
  const events: Array<{ level: string; name: string; attributes?: Record<string, unknown> }> = [];
  const tracer = new Tracer({ minLevel: "trace" });
  tracer.addWriter({
    onSpanStart: () => {},
    onSpanEnd: () => {},
    onEvent: (_span, event: SpanEvent) =>
      events.push({ level: event.level, name: event.name, attributes: event.attributes }),
  });
  return { tracer, events };
}

describe("logTurnContent citations", () => {
  test("dedupes sources by url for the info preview but counts every citation", () => {
    const { tracer, events } = captureEvents();
    const content: ContentPart[] = [
      {
        type: "citation",
        citations: [
          { source: { type: "web", url: "https://a.com", title: "A" } },
          { source: { type: "web", url: "https://a.com", title: "A" } },
          { source: { type: "web", url: "https://b.com" } },
        ],
      },
    ];

    logTurnContent(tracer.startSpan("turn"), content);

    const cite = events.find((e) => e.name === "citations" && e.level === "info");
    expect(cite?.attributes?.count).toBe(3);
    expect(cite?.attributes?.sources).toHaveLength(2);
  });

  test("emits no citations event when the turn cited nothing", () => {
    const { tracer, events } = captureEvents();

    logTurnContent(tracer.startSpan("turn"), [{ type: "text", text: "hi" }]);

    expect(events.some((e) => e.name === "citations")).toBe(false);
  });
});
