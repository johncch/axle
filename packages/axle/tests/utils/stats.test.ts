import { describe, expect, test } from "vitest";
import {
  addStats,
  attributeStats,
  mergeStats,
  toTokenUsage,
  withUsageDetails,
} from "../../src/utils/stats.js";

describe("stats utilities", () => {
  test("sums token detail fields", () => {
    const total = { in: 10, out: 2, cachedIn: 1 };

    addStats(total, { in: 5, out: 3, cachedIn: 2 });
    addStats(total, { in: 1, out: 1 });

    expect(total).toEqual({ in: 16, out: 6, cachedIn: 3 });
  });

  test("preserves token details in tracing usage", () => {
    const usage = withUsageDetails({ in: 10, out: 5 }, { cachedIn: 4, reasoningOut: 2 });

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

  test("attributes usage to a provider+model entry without double counting", () => {
    const total = { in: 2, out: 1 };
    const child = attributeStats(
      { in: 3, out: 4, cachedIn: 1 },
      { provider: "child-provider", model: "child-model" },
    );

    addStats(total, child);

    expect(total).toEqual({
      in: 5,
      out: 5,
      cachedIn: 1,
      breakdown: [{ provider: "child-provider", model: "child-model", in: 3, out: 4, cachedIn: 1 }],
    });
  });

  test("merges breakdown entries for the same provider and model", () => {
    const total = { in: 0, out: 0 };

    addStats(total, attributeStats({ in: 1, out: 2 }, { provider: "p", model: "m" }));
    addStats(total, attributeStats({ in: 3, out: 4, cachedIn: 5 }, { provider: "p", model: "m" }));

    expect(total).toEqual({
      in: 4,
      out: 6,
      cachedIn: 5,
      breakdown: [{ provider: "p", model: "m", in: 4, out: 6, cachedIn: 5 }],
    });
  });

  test("keeps separate breakdown entries per provider and model", () => {
    expect(
      mergeStats(
        attributeStats({ in: 1, out: 2 }, { provider: "anthropic", model: "parent" }),
        attributeStats({ in: 3, out: 4 }, { provider: "openai", model: "child" }),
      ),
    ).toEqual({
      in: 4,
      out: 6,
      breakdown: [
        { provider: "anthropic", model: "parent", in: 1, out: 2 },
        { provider: "openai", model: "child", in: 3, out: 4 },
      ],
    });
  });
});
