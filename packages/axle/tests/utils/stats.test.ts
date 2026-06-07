import { describe, expect, test } from "vitest";
import { addStats, toTokenUsage, withUsageDetails } from "../../src/utils/stats.js";

describe("stats utilities", () => {
  test("sums token detail fields", () => {
    const total = { in: 10, out: 2, cachedIn: 1 };

    addStats(total, { in: 5, out: 3, cachedIn: 2 });
    addStats(total, { in: 1, out: 1 });

    expect(total).toEqual({ in: 16, out: 6, cachedIn: 3 });
  });

  test("preserves token details in tracing usage", () => {
    const usage = withUsageDetails(
      { in: 10, out: 5 },
      { cachedIn: 4, reasoningOut: 2 },
    );

    expect(usage).toEqual({
      in: 10,
      out: 5,
      cachedIn: 4,
      reasoningOut: 2,
    });
    expect(toTokenUsage(usage)).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cachedInputTokens: 4,
      reasoningOutputTokens: 2,
    });
  });
});
