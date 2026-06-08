import { describe, expect, test, vi } from "vitest";
import { resolveObservability } from "../../src/core/agent/observability.js";
import { Tracer } from "../../src/observability/tracer.js";

describe("resolveObservability", () => {
  test("trace wins over log and warns that log is ignored", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tracer = new Tracer();

    const resolved = resolveObservability({ trace: tracer, log: () => {} });

    expect(resolved.parent).toBe(tracer);
    expect(resolved.owned).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  test("log alone creates an Axle-owned tracer without warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const resolved = resolveObservability({ log: () => {} });

    expect(resolved.owned).toBeDefined();
    expect(resolved.parent).toBe(resolved.owned);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
