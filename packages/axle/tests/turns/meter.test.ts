import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ModelCatalog } from "../../src/models/catalog.js";
import { Meter } from "../../src/turns/meter.js";
import type { Stats, UsageEntry } from "../../src/types.js";

const TEST_DIR = join(import.meta.dirname, "__meter_tmp__");
const CACHE_PATH = join(TEST_DIR, "models.json");

const sonnet = {
  name: "Sonnet",
  limit: { context: 1_000_000 },
  reasoning: true,
  toolCall: true,
  attachment: false,
  modalities: { input: ["text"], output: ["text"] },
};

const cacheFile = {
  version: 3,
  fetchedAt: new Date().toISOString(),
  etags: {},
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

async function openCatalog(): Promise<ModelCatalog> {
  await writeFile(CACHE_PATH, JSON.stringify(cacheFile));
  return ModelCatalog.open({ cachePath: CACHE_PATH });
}

function row(entry: Partial<UsageEntry> & Pick<UsageEntry, "in" | "out">): UsageEntry {
  return { provider: "acme", model: "sonnet", requestedModel: "sonnet", ...entry };
}

function turnEnd(rows: UsageEntry[]) {
  const usage: Stats = { in: 0, out: 0, breakdown: rows };
  for (const entry of rows) {
    usage.in += entry.in;
    usage.out += entry.out;
    if (entry.cachedIn !== undefined) usage.cachedIn = (usage.cachedIn ?? 0) + entry.cachedIn;
  }
  return { type: "turn:end" as const, turnId: "t1", status: "complete" as const, usage };
}

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("Meter usage", () => {
  test("folds turn:end usage and ignores other events", () => {
    const meter = new Meter();
    meter.apply({ type: "turn:start", turnId: "t1" });
    meter.apply(turnEnd([row({ in: 100, out: 10 })]));
    meter.apply(turnEnd([row({ in: 50, out: 5, cachedIn: 20 })]));

    expect(meter.usage).toEqual({
      in: 150,
      out: 15,
      cachedIn: 20,
      breakdown: [row({ in: 100, out: 10 }), row({ in: 50, out: 5, cachedIn: 20 })],
    });
    expect(meter.observedUsage).toEqual(meter.usage);
  });

  test("restore seeds usage; observed holds only what this instance applied", async () => {
    const saved: Stats = { in: 1000, out: 100, breakdown: [row({ in: 1000, out: 100 })] };
    const meter = new Meter(await openCatalog(), saved);
    meter.apply(turnEnd([row({ in: 100_000, out: 0 })]));

    expect(meter.usage.in).toBe(101_000);
    expect(meter.observedUsage.in).toBe(100_000);
    expect(meter.cost.priced).toHaveLength(2);
    expect(meter.cost.usd).toBeCloseTo(0.003 + 0.2);
    expect(meter.observedCost.priced).toHaveLength(1);
    expect(meter.observedCost.usd).toBeCloseTo(0.2);
    expect(saved.in).toBe(1000);
    expect(saved.breakdown).toHaveLength(1);
  });
});

describe("Meter cost", () => {
  test("prices input and output per million at the base tier", async () => {
    const meter = new Meter(await openCatalog());
    meter.apply(turnEnd([row({ in: 100_000, out: 100_000 })]));

    expect(meter.cost).toEqual({
      usd: 1.2,
      priced: [{ ...row({ in: 100_000, out: 100_000 }), usd: 1.2 }],
      unpriced: [],
    });
  });

  test("prices cache reads, cache writes and reasoning at their own rates", async () => {
    const meter = new Meter(await openCatalog());
    meter.apply(
      turnEnd([
        row({
          in: 100_000,
          out: 10_000,
          cachedIn: 50_000,
          cacheWriteIn: 20_000,
          reasoningOut: 4_000,
        }),
      ]),
    );

    // 30k plain in at 2, 50k cache read at 0.2, 20k cache write at 2.5,
    // 6k plain out at 10, 4k reasoning at 20
    const expected = (30_000 * 2 + 50_000 * 0.2 + 20_000 * 2.5 + 6_000 * 10 + 4_000 * 20) / 1e6;
    expect(meter.cost.usd).toBeCloseTo(expected);
  });

  test("prices cache and reasoning tokens as plain input and output when the host lists no rate", async () => {
    const meter = new Meter(await openCatalog());
    meter.apply(
      turnEnd([
        row({ model: "plain", in: 100_000, out: 10_000, cachedIn: 50_000, reasoningOut: 4_000 }),
      ]),
    );

    expect(meter.cost.usd).toBeCloseTo((100_000 * 1 + 10_000 * 1) / 1e6);
  });

  test("selects the tier the request's prompt size exceeds", async () => {
    const meter = new Meter(await openCatalog());
    meter.apply(turnEnd([row({ in: 200_000, out: 0 }), row({ in: 200_001, out: 0, cachedIn: 1 })]));

    expect(meter.cost.priced[0].usd).toBeCloseTo((200_000 * 2) / 1e6);
    // tiered: 200,000 plain at 4 plus one cached token at 0.4
    expect(meter.cost.priced[1].usd).toBeCloseTo((200_000 * 4 + 1 * 0.4) / 1e6);
  });

  test("falls back to the requested model when the reported one is not listed", async () => {
    const meter = new Meter(await openCatalog());
    meter.apply(turnEnd([row({ model: "sonnet-2026-01-01", in: 100_000, out: 0 })]));

    expect(meter.cost.usd).toBeCloseTo(0.2);
  });

  test("names why a row is unpriced: no provider, unlisted, or listed without a price", async () => {
    const meter = new Meter(await openCatalog());
    const noProvider: UsageEntry = { model: "sonnet", requestedModel: "sonnet", in: 10, out: 1 };
    const unlisted = row({ model: "nope", requestedModel: "nope", in: 10, out: 1 });
    const noPrice = row({ model: "free", requestedModel: "free", in: 10, out: 1 });
    meter.apply(turnEnd([noProvider, unlisted, noPrice, row({ in: 100_000, out: 0 })]));

    expect(meter.cost.usd).toBeCloseTo(0.2);
    expect(meter.cost.unpriced).toEqual([
      { ...noProvider, reason: "no-provider" },
      { ...unlisted, reason: "unlisted" },
      { ...noPrice, reason: "no-price" },
    ]);
    expect(meter.cost.priced).toHaveLength(1);
  });

  test("prices nothing without a catalog and says so", async () => {
    const meter = new Meter();
    meter.apply(turnEnd([row({ in: 100_000, out: 0 })]));

    expect(meter.cost).toEqual({
      usd: 0,
      priced: [],
      unpriced: [{ ...row({ in: 100_000, out: 0 }), reason: "no-catalog" }],
    });
    await expect(meter.priced()).resolves.toEqual(meter.cost);
  });

  test("reports loading until the catalog arrives, then prices the same rows", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const body = JSON.stringify({
      "acme/sonnet": {
        ...sonnet,
        tool_call: true,
        cost: { input: 2, output: 10 },
      },
    });
    const api = JSON.stringify({
      acme: { models: { sonnet: { ...sonnet, tool_call: true, cost: { input: 2, output: 10 } } } },
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation((url: string) =>
          gate.then(() => new Response(url.endsWith("/models.json") ? body : api, { status: 200 })),
        ),
    );
    const catalog = await ModelCatalog.open({ cachePath: CACHE_PATH });
    const meter = new Meter(catalog);
    meter.apply(turnEnd([row({ in: 100_000, out: 0 })]));

    expect(meter.cost.unpriced.map((entry) => entry.reason)).toEqual(["loading"]);

    release();
    const cost = await meter.priced();

    expect(cost.unpriced).toEqual([]);
    expect(cost.usd).toBeCloseTo(0.2);
    expect(meter.cost).toEqual(cost);
  });

  test("reports unavailable when the catalog has no cache and cannot fetch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const catalog = await ModelCatalog.open({ cachePath: CACHE_PATH, retryDelays: [] });
    const meter = new Meter(catalog);
    meter.apply(turnEnd([row({ in: 100_000, out: 0 })]));

    const cost = await meter.priced();

    expect(cost.usd).toBe(0);
    expect(cost.unpriced.map((entry) => entry.reason)).toEqual(["unavailable"]);
  });
});
