import { describe, expect, it } from "vitest";
import { AxleAbortError } from "../../src/errors/AxleAbortError.js";
import { AxleError, AxleErrorCode } from "../../src/errors/AxleError.js";
import { isAxleError } from "../../src/errors/guard.js";

class ForeignCopyError extends Error {
  readonly code = AxleErrorCode.INVALID_OPTIONS;
}

describe("isAxleError", () => {
  it("accepts errors built by this package", () => {
    expect(isAxleError(new AxleError("x"))).toBe(true);
    expect(isAxleError(new AxleAbortError())).toBe(true);
  });

  it("accepts an Error carrying an Axle code from another copy of the package", () => {
    const error: unknown = new ForeignCopyError("x");
    expect(isAxleError(error)).toBe(true);
    if (isAxleError(error)) expect(error.code).toBe("INVALID_OPTIONS");
  });

  it("rejects errors without an Axle code, and non-errors", () => {
    expect(isAxleError(new Error("x"))).toBe(false);
    expect(isAxleError(Object.assign(new Error("x"), { code: "ENOENT" }))).toBe(false);
    expect(isAxleError({ code: "ABORTED", message: "x" })).toBe(false);
    expect(isAxleError(undefined)).toBe(false);
  });
});
