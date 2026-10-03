import { describe, expect, it } from "vitest";
import { formatActionResult } from "../../src/ui/format.js";

describe("formatActionResult", () => {
  it("shows the first line of a string result", () => {
    expect(formatActionResult({ type: "success", content: "5117\nmore" })).toEqual({
      text: "5117",
      tone: "dim",
    });
  });

  it("shows stdout for a clean console run", () => {
    expect(
      formatActionResult({ type: "success", content: { stdout: "5117\n", exitCode: 0 } }),
    ).toEqual({ text: "5117", tone: "dim" });
  });

  it("shows stderr and the exit code for a failed console run", () => {
    expect(
      formatActionResult({
        type: "success",
        content: { stdout: "", stderr: "NameError: primes\n", exitCode: 1 },
      }),
    ).toEqual({ text: "NameError: primes (exit 1)", tone: "error" });
  });

  it("shows nothing for an empty result", () => {
    expect(formatActionResult({ type: "success" })).toBeUndefined();
    expect(formatActionResult({ type: "success", content: { stdout: "  " } })).toBeUndefined();
  });

  it("shows an error message in the error tone", () => {
    expect(
      formatActionResult({
        type: "error",
        error: { message: "code_execution failed: unavailable" },
      }),
    ).toEqual({ text: "code_execution failed: unavailable", tone: "error" });
  });
});
