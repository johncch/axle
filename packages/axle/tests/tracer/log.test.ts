import { describe, expect, test } from "vitest";
import { Tracer } from "../../src/observability/index.js";
import type { LogEntry } from "../../src/observability/log.js";
import { LogWriter } from "../../src/observability/log.js";

describe("LogWriter", () => {
  test("projects in-span log events and the span's completion", () => {
    const entries: LogEntry[] = [];
    const tracer = new Tracer();
    tracer.addWriter(new LogWriter((entry) => entries.push(entry)));

    const root = tracer.startSpan("run", { type: "workflow" });
    root.info("started", { foo: "bar" });
    root.end("ok");

    expect(entries).toHaveLength(2);

    // the in-span log event
    expect(entries[0]).toMatchObject({
      level: "info",
      message: "started",
      fields: { name: "run", foo: "bar" },
    });
    expect(typeof entries[0].fields?.traceId).toBe("string");
    expect(typeof entries[0].fields?.spanId).toBe("string");

    // the span completion
    expect(entries[1]).toMatchObject({
      level: "info",
      message: "run",
      fields: { type: "workflow", status: "ok" },
    });
    expect(typeof entries[1].fields?.durationMs).toBe("number");
  });

  test("respects the tracer minLevel threshold", () => {
    const entries: LogEntry[] = [];
    const tracer = new Tracer(); // default minLevel "info"
    tracer.addWriter(new LogWriter((entry) => entries.push(entry)));

    const span = tracer.startSpan("op");
    span.debug("filtered");
    expect(entries).toHaveLength(0);

    tracer.minLevel = "debug";
    span.debug("visible");
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe("visible");
  });

  test("projects tool span completions (info on ok, error on failure)", () => {
    const entries: LogEntry[] = [];
    const tracer = new Tracer();
    tracer.addWriter(new LogWriter((entry) => entries.push(entry)));

    tracer.startSpan("search", { type: "tool" }).end("ok");
    tracer.startSpan("write_file", { type: "tool" }).end("error");

    expect(entries).toMatchObject([
      { level: "info", message: "search", fields: { type: "tool", status: "ok" } },
      { level: "error", message: "write_file", fields: { type: "tool", status: "error" } },
    ]);
  });

  test("projects every span with parent links so the tree can be reconstructed", () => {
    const entries: LogEntry[] = [];
    const tracer = new Tracer();
    tracer.minLevel = "debug"; // the full span tree (turns) is debug-depth
    tracer.addWriter(new LogWriter((entry) => entries.push(entry)));

    const root = tracer.startSpan("agent.send", { type: "workflow" });
    const turn = root.startSpan("turn-1", { type: "llm" });
    turn.startSpan("exec", { type: "tool" }).end("ok");
    turn.end("ok");
    root.end("ok");

    const exec = entries.find((e) => e.message === "exec");
    const turnEntry = entries.find((e) => e.message === "turn-1");
    const rootEntry = entries.find((e) => e.message === "agent.send");

    expect(rootEntry?.fields?.parentSpanId).toBeUndefined();
    expect(turnEntry?.fields?.parentSpanId).toBe(rootEntry?.fields?.spanId);
    expect(exec?.fields?.parentSpanId).toBe(turnEntry?.fields?.spanId);
  });
});
