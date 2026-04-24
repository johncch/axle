import { describe, expect, it } from "vitest";
import { SimpleWriter } from "../../src/tracer/writers/simple.js";
import type { SpanData } from "../../src/tracer/types.js";

const span: SpanData = {
  traceId: "trace",
  spanId: "span",
  name: "root",
  startTime: Date.now(),
  status: "ok",
  attributes: {},
  events: [],
};

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

describe("SimpleWriter", () => {
  it("renders opted-in markdown events for terminal output", () => {
    const lines: string[] = [];
    const writer = new SimpleWriter({
      markdown: true,
      showTimestamp: false,
      output: (line) => lines.push(line),
    });

    writer.onEvent(span, {
      name: "# Result\n\n- **Done** with `code`",
      timestamp: Date.now(),
      level: "info",
      attributes: { markdown: true },
    });

    expect(stripAnsi(lines[0])).toBe("  INFO  Result\n- Done with code");
  });

  it("leaves markdown text unchanged without event opt-in", () => {
    const lines: string[] = [];
    const writer = new SimpleWriter({
      markdown: true,
      showTimestamp: false,
      output: (line) => lines.push(line),
    });

    writer.onEvent(span, {
      name: "# Result",
      timestamp: Date.now(),
      level: "info",
    });

    expect(lines[0]).toBe("  INFO  # Result");
  });
});
