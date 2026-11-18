import { describe, expect, test } from "vitest";
import * as analyzeEntry from "../src/analyze.js";
import * as root from "../src/index.js";

describe("analyze entrypoint", () => {
  test("exports analyze, the predicates and the functions", () => {
    expect(Object.keys(analyzeEntry).sort()).toEqual([
      "analyze",
      "byAgent",
      "byUser",
      "cancelled",
      "completed",
      "failed",
      "flatten",
      "named",
      "partOf",
      "repeats",
      "simplify",
      "streaks",
      "sum",
    ]);
  });

  test("keeps its generic names off the package root", () => {
    for (const name of ["analyze", "failed", "completed", "named", "flatten"]) {
      expect(root).not.toHaveProperty(name);
    }
  });
});
