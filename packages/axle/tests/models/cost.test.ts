import { describe, expect, test } from "vitest";
import type { CatalogData } from "../../src/models/catalog.js";
import { ModelCatalog } from "../../src/models/catalog.js";
import { computeCost } from "../../src/models/cost.js";
import type { Stats, UsageEntry } from "../../src/types.js";

const sonnet = {
  name: "Sonnet",
  limit: { context: 1_000_000 },
  reasoning: true,
  toolCall: true,
  attachment: false,
  modalities: { input: ["text"], output: ["text"] },
};

const data: CatalogData = {
  version: 4,
  fetchedAt: "2026-10-30T00:00:00.000Z",
  etags: {},
  coverage: "all",
  models: { "acme/sonnet": sonnet, "acme/plain": sonnet },
  providers: {
    acme: {
      sonnet: {
        canonical: "acme/sonnet",
        cost: {
          input: 2,
          output: 10,
          cacheRead: 0.2,
          cacheWrite: 2.5,
          reasoning: 20,
          tiers: [{ size: 200_000, input: 4, output: 20, cacheRead: 0.4 }],
        },
      },
      plain: { canonical: "acme/plain", cost: { input: 1, output: 1 } },
      free: { canonical: "acme/plain" },
    },
  },
};

const catalog = new ModelCatalog(data);

const AT = "2026-10-30T12:00:00.000Z";

function row(entry: Partial<UsageEntry> & Pick<UsageEntry, "in" | "out">): UsageEntry {
  return { provider: "acme", model: "sonnet", requestedModel: "sonnet", at: AT, ...entry };
}

function stats(rows: UsageEntry[]): Stats {
  const usage: Stats = { in: 0, out: 0, breakdown: rows };
  for (const entry of rows) {
    usage.in += entry.in;
    usage.out += entry.out;
  }
  return usage;
}

describe("computeCost", () => {
  test("prices input and output per million at the base tier", () => {
    const cost = computeCost(stats([row({ in: 100_000, out: 100_000 })]), catalog);

    expect(cost).toEqual({
      usd: 1.2,
      priced: [{ ...row({ in: 100_000, out: 100_000 }), usd: 1.2 }],
      unpriced: [],
      pricedWith: data.fetchedAt,
    });
  });

  test("prices cache reads, cache writes and reasoning at their own rates", () => {
    const usage = stats([
      row({
        in: 100_000,
        out: 10_000,
        cachedIn: 50_000,
        cacheWriteIn: 20_000,
        reasoningOut: 4_000,
      }),
    ]);

    const cost = computeCost(usage, catalog);

    // 30k plain in at 2, 50k cache read at 0.2, 20k cache write at 2.5,
    // 6k plain out at 10, 4k reasoning at 20
    const expected = (30_000 * 2 + 50_000 * 0.2 + 20_000 * 2.5 + 6_000 * 10 + 4_000 * 20) / 1e6;
    expect(cost.usd).toBeCloseTo(expected);
  });

  test("prices cache and reasoning tokens as plain input and output when the host lists no rate", () => {
    const usage = stats([
      row({ model: "plain", in: 100_000, out: 10_000, cachedIn: 50_000, reasoningOut: 4_000 }),
    ]);

    const cost = computeCost(usage, catalog);

    expect(cost.usd).toBeCloseTo((100_000 * 1 + 10_000 * 1) / 1e6);
  });

  test("selects the tier the request's prompt size exceeds", () => {
    const usage = stats([row({ in: 200_000, out: 0 }), row({ in: 200_001, out: 0, cachedIn: 1 })]);

    const cost = computeCost(usage, catalog);

    expect(cost.priced[0].usd).toBeCloseTo((200_000 * 2) / 1e6);
    // tiered: 200,000 plain at 4 plus one cached token at 0.4
    expect(cost.priced[1].usd).toBeCloseTo((200_000 * 4 + 1 * 0.4) / 1e6);
  });

  test("falls back to the requested model when the reported one is not listed", () => {
    const usage = stats([row({ model: "sonnet-2026-01-01", in: 100_000, out: 0 })]);

    expect(computeCost(usage, catalog).usd).toBeCloseTo(0.2);
  });

  test("names why a row is unpriced: no provider, unlisted, or listed without a price", () => {
    const noProvider: UsageEntry = {
      model: "sonnet",
      requestedModel: "sonnet",
      at: AT,
      in: 10,
      out: 1,
    };
    const unlisted = row({ model: "nope", requestedModel: "nope", in: 10, out: 1 });
    const noPrice = row({ model: "free", requestedModel: "free", in: 10, out: 1 });

    const cost = computeCost(
      stats([noProvider, unlisted, noPrice, row({ in: 100_000, out: 0 })]),
      catalog,
    );

    expect(cost.usd).toBeCloseTo(0.2);
    expect(cost.unpriced).toEqual([
      { ...noProvider, reason: "no-provider" },
      { ...unlisted, reason: "unlisted" },
      { ...noPrice, reason: "no-price" },
    ]);
    expect(cost.priced).toHaveLength(1);
  });

  test("prices nothing without a catalog and says so", () => {
    const cost = computeCost(stats([row({ in: 100_000, out: 0 })]));

    expect(cost).toEqual({
      usd: 0,
      priced: [],
      unpriced: [{ ...row({ in: 100_000, out: 0 }), reason: "no-catalog" }],
    });
  });
});
