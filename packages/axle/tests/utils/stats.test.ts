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

  test("keeps one breakdown row per request for the same provider and model", () => {
    const total = { in: 0, out: 0 };

    addStats(total, attributeStats({ in: 1, out: 2 }, { provider: "p", model: "m" }));
    addStats(total, attributeStats({ in: 3, out: 4, cachedIn: 5 }, { provider: "p", model: "m" }));

    expect(total).toEqual({
      in: 4,
      out: 6,
      cachedIn: 5,
      breakdown: [
        { provider: "p", model: "m", in: 1, out: 2 },
        { provider: "p", model: "m", in: 3, out: 4, cachedIn: 5 },
      ],
    });
  });

  test("stamps the agent name on the row it attributes", () => {
    expect(
      attributeStats({ in: 1, out: 2 }, { provider: "p", model: "m", agent: "researcher" })
        .breakdown,
    ).toEqual([{ provider: "p", model: "m", agent: "researcher", in: 1, out: 2 }]);
  });

  test("leaves provider off the row when the provider has no id", () => {
    expect(attributeStats({ in: 1, out: 2 }, { model: "m" }).breakdown).toEqual([
      { model: "m", in: 1, out: 2 },
    ]);
  });

  test("keeps a provider's own per-request rows and stamps the provider and agent on each", () => {
    const stepUsage = {
      in: 50,
      out: 27,
      breakdown: [
        { model: "claude-x", in: 10, out: 20 },
        { model: "claude-x", in: 40, out: 7 },
      ],
    };

    expect(
      attributeStats(stepUsage, { provider: "anthropic", model: "claude-x", agent: "researcher" }),
    ).toEqual({
      in: 50,
      out: 27,
      breakdown: [
        { provider: "anthropic", model: "claude-x", agent: "researcher", in: 10, out: 20 },
        { provider: "anthropic", model: "claude-x", agent: "researcher", in: 40, out: 7 },
      ],
    });
  });

  test("keeps rows in request order across providers", () => {
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
