import { describe, expect, test } from "vitest";
import { redactKeys } from "../../src/utils/redact.js";

describe("redactKeys", () => {
  const keys = new Set(["data", "url"]);

  test("redacts string at matching key", () => {
    expect(redactKeys({ data: "secret" }, keys)).toEqual({ data: "[redacted]" });
  });

  test("leaves non-matching keys alone", () => {
    expect(redactKeys({ name: "ok" }, keys)).toEqual({ name: "ok" });
  });

  test("uses custom placeholder", () => {
    expect(redactKeys({ data: "secret" }, keys, "[REDACTED]")).toEqual({ data: "[REDACTED]" });
  });

  test("recurses into nested objects", () => {
    expect(redactKeys({ outer: { data: "secret" } }, keys)).toEqual({
      outer: { data: "[redacted]" },
    });
  });

  test("redacts string entries inside an array under a matching key", () => {
    expect(redactKeys({ data: ["a", "b"] }, keys)).toEqual({
      data: ["[redacted]", "[redacted]"],
    });
  });

  test("redacts inside arrays of objects", () => {
    expect(redactKeys({ items: [{ data: "x" }, { data: "y" }] }, keys)).toEqual({
      items: [{ data: "[redacted]" }, { data: "[redacted]" }],
    });
  });

  test("does not redact string at top level (no parent key)", () => {
    expect(redactKeys("data", keys)).toBe("data");
  });

  test("preserves non-string values under matching keys", () => {
    expect(redactKeys({ data: 42, url: null }, keys)).toEqual({ data: 42, url: null });
  });
});
