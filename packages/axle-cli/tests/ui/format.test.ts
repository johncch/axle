import { describe, expect, it } from "vitest";
import { contextPie, formatActionResult, formatFailure } from "../../src/ui/format.js";

describe("contextPie", () => {
  it.each([
    [0, "○ 0%"],
    [0.03, "○ 3%"],
    [0.125, "◔ 13%"],
    [0.21, "◔ 21%"],
    [0.48, "◑ 48%"],
    [0.71, "◕ 71%"],
    [0.79, "◕ 79%"],
    [0.8, "● 80%"],
    [1.1, "● 110%"],
  ])("renders %s as %s", (fraction, expected) => {
    expect(contextPie(fraction)).toBe(expected);
  });
});

describe("formatFailure", () => {
  it("marks a one-line failure", () => {
    expect(formatFailure("Recipe not found", 80)).toBe("✖ Recipe not found");
  });

  it("wraps under the message and keeps a list item's text aligned", () => {
    const message = [
      "Invalid config file at /home/me/.axle/cli.yaml:",
      '  - providers.anthropic: "anthropic" is a preset and takes no baseUrl. Remove it.',
    ].join("\n");

    expect(formatFailure(message, 40).split("\n")).toEqual([
      "✖ Invalid config file at",
      "  /home/me/.axle/cli.yaml:",
      '    - providers.anthropic: "anthropic"',
      "      is a preset and takes no baseUrl.",
      "      Remove it.",
    ]);
  });

  it("leaves lines whole at an unlimited width", () => {
    const message = `first ${"word ".repeat(40).trim()}`;

    expect(formatFailure(message, Number.POSITIVE_INFINITY)).toBe(`✖ ${message}`);
  });
});

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
