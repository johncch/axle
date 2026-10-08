import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelCatalog } from "../../src/models/catalog.js";

const TEST_DIR = join(import.meta.dirname, "__catalog_tmp__");
const CACHE_PATH = join(TEST_DIR, "cache", "models.json");
const FIXTURES = join(import.meta.dirname, "..", "fixtures");
const DAY = 24 * 60 * 60 * 1000;

type Outcome = Response | Error;

/** Stubs fetch per path; a missing path rejects like a network failure. */
function stubFetch(outcomes: { models?: () => Outcome; api?: () => Outcome }) {
  const mock = vi.fn().mockImplementation((url: string) => {
    const make = url.endsWith("/models.json") ? outcomes.models : outcomes.api;
    const outcome = make?.() ?? new Error("offline");
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

async function fixture(
  name: string,
  headers: Record<string, string> = {},
): Promise<() => Response> {
  const body = await readFile(join(FIXTURES, name), "utf-8");
  return () => new Response(body, { status: 200, headers });
}

async function stubBoth() {
  return stubFetch({
    models: await fixture("models-dev.json", { etag: '"m1"' }),
    api: await fixture("models-dev-api.json", { etag: '"a1"' }),
  });
}

async function writeCache(ageMs: number, models: Record<string, unknown>, etags = {}) {
  await mkdir(join(TEST_DIR, "cache"), { recursive: true });
  await writeFile(
    CACHE_PATH,
    JSON.stringify({
      version: 2,
      fetchedAt: new Date(Date.now() - ageMs).toISOString(),
      etags,
      models,
      hosts: {},
    }),
  );
}

const acmeModel = {
  name: "Acme",
  limit: { context: 1234 },
  reasoning: false,
  toolCall: true,
  attachment: false,
  modalities: { input: ["text"], output: ["text"] },
};

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("ModelCatalog.lookup", () => {
  let catalog: ModelCatalog;

  beforeEach(async () => {
    await stubBoth();
    catalog = await ModelCatalog.open({ cachePath: CACHE_PATH });
    await catalog.refresh();
  });

  it("matches a host's own id and returns the host's limits and prices", () => {
    const found = catalog.lookup("z-ai/glm-5.3-flash", { host: "openrouter" });
    expect(found).toMatchObject({
      id: "zhipuai/glm-5.3-flash",
      match: "host",
      model: { name: "GLM-5.3-Flash", limit: { context: 1_048_576, output: 943_717 } },
      cost: { input: 0.15, output: 0.5, cacheRead: 0.03 },
    });
    expect(found?.model.toolCall).toBe(true);
  });

  it("qualifies a first-party host id into the canonical key", () => {
    expect(catalog.lookup("claude-sonnet-5", { host: "anthropic" })).toMatchObject({
      id: "anthropic/claude-sonnet-5",
      match: "host",
      model: { limit: { context: 1_000_000, output: 128_000 } },
      cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
    });
  });

  it("keeps a host-only model's record when the catalog has no canonical entry", () => {
    expect(catalog.lookup("zai-org/GLM-5.1", { host: "togetherai" })).toMatchObject({
      id: "togetherai/zai-org/GLM-5.1",
      match: "host",
      model: { limit: { context: 202_752 } },
      cost: { input: 1.4, output: 4.4 },
    });
    expect(
      catalog.lookup("sao10k/l3-lunaris-8b", { host: "openrouter" })?.model.limit.context,
    ).toBe(8192);
  });

  it("ignores case in a host id", () => {
    expect(catalog.lookup("zai-org/glm-5.1", { host: "togetherai" })?.match).toBe("host");
  });

  it("falls through to the canonical layer for an unknown host or id", () => {
    expect(catalog.lookup("anthropic/claude-sonnet-5", { host: "nowhere" })).toMatchObject({
      id: "anthropic/claude-sonnet-5",
      match: "exact",
    });
    expect(catalog.lookup("anthropic/claude-sonnet-5", { host: "openrouter" })?.match).toBe(
      "exact",
    );
    expect(
      catalog.lookup("anthropic/claude-sonnet-5", { host: "openrouter" })?.cost,
    ).toBeUndefined();
  });

  it("looks a publisher-qualified id up as an exact key, ignoring case", () => {
    expect(catalog.lookup("anthropic/claude-sonnet-5")).toMatchObject({
      id: "anthropic/claude-sonnet-5",
      match: "exact",
      model: { reasoning: true, attachment: true, knowledge: "2026-01-31" },
    });
    expect(catalog.lookup("google/gemma-4-e4b-it")?.id).toBe("google/gemma-4-E4B-it");
  });

  it("qualifies a bare id with the given publisher", () => {
    expect(catalog.contextWindow("gemini-2.5-pro", { publisher: "google" })).toEqual({
      window: 1_048_576,
      id: "google/gemini-2.5-pro",
      match: "exact",
    });
  });

  it.each([
    ["gpt-oss:20b", "openai/gpt-oss-20b", "exact", 131_072],
    ["glm-4.7-flash:q8_0", "zhipuai/glm-4.7-flash", "exact", 200_000],
    ["muse-glimmer:30b-mlx", "meta/muse-glimmer-30b", "exact", 131_072],
    ["gemma4:26b-mlx", "google/gemma-4-26b-a4b-it", "prefix", 262_144],
    ["gemma4:e4b-mlx", "google/gemma-4-E4B-it", "prefix", 131_072],
    ["gemma3:12b", "google/gemma-3-12b-it", "prefix", 131_072],
  ])("matches the local name %s to %s", (local, id, match, window) => {
    expect(catalog.contextWindow(local)).toEqual({ window, id, match });
  });

  it("matches a vendor slug by its model part when no host is given", () => {
    expect(catalog.lookup("z-ai/glm-4.7-flash")?.id).toBe("zhipuai/glm-4.7-flash");
  });

  it("gives up when more than one entry shares the prefix", () => {
    expect(catalog.lookup("gemma3:latest")).toBeUndefined();
    expect(catalog.lookup("gemma4")).toBeUndefined();
  });

  it("gives up on a name the catalog lacks", () => {
    expect(catalog.lookup("totally-unknown")).toBeUndefined();
    expect(catalog.lookup("acme/unknown")).toBeUndefined();
    expect(catalog.lookup("acme/unknown", { host: "openrouter" })).toBeUndefined();
  });
});

describe("ModelCatalog cache", () => {
  it("opens empty without a cache file and resolves nothing", async () => {
    const catalog = await ModelCatalog.open({ cachePath: CACHE_PATH });
    expect(catalog.size).toBe(0);
    expect(catalog.fetchedAt).toBeUndefined();
    expect(catalog.stale).toBe(true);
    expect(catalog.contextWindow("anthropic/claude-sonnet-5")).toBeUndefined();
  });

  it("refresh writes a slimmed two-layer cache that a later open reads without fetching", async () => {
    const fetched = await stubBoth();
    const catalog = await ModelCatalog.open({ cachePath: CACHE_PATH });
    await catalog.refresh();
    expect(fetched).toHaveBeenCalledTimes(2);

    const file = JSON.parse(await readFile(CACHE_PATH, "utf-8"));
    expect(file.version).toBe(2);
    expect(file.etags).toEqual({ models: '"m1"', api: '"a1"' });
    expect(file.models["anthropic/claude-sonnet-5"].limit.context).toBe(1_000_000);
    expect(file.models["anthropic/claude-sonnet-5"]).not.toHaveProperty("benchmarks");
    expect(file.hosts.openrouter["z-ai/glm-5.3-flash"]).toMatchObject({
      canonical: "zhipuai/glm-5.3-flash",
    });
    expect(file.hosts.openrouter["z-ai/glm-5.3-flash"]).not.toHaveProperty("model");
    expect(file.hosts.togetherai["zai-org/GLM-5.1"]).not.toHaveProperty("canonical");
    expect(file.hosts.togetherai["zai-org/GLM-5.1"].model.name).toBe("GLM-5.1");
    expect(catalog.size).toBe(14);

    fetched.mockClear();
    const reopened = await ModelCatalog.open({ cachePath: CACHE_PATH });
    expect(fetched).not.toHaveBeenCalled();
    expect(reopened.stale).toBe(false);
    expect(reopened.contextWindow("openai/gpt-5")?.window).toBe(400_000);
    expect(reopened.lookup("claude-sonnet-5", { host: "anthropic" })?.cost?.input).toBe(2);
  });

  it("holds the catalog in memory when no cachePath is given", async () => {
    await stubBoth();
    const catalog = await ModelCatalog.open();
    await catalog.refresh();

    expect(catalog.size).toBe(14);
    expect(catalog.lookup("z-ai/glm-5.3-flash", { host: "openrouter" })?.match).toBe("host");
    await expect(stat(CACHE_PATH)).rejects.toThrow();
  });

  it("hosts: [] skips api.json; hosts: [...] keeps only those", async () => {
    const fetched = await stubBoth();
    const none = await ModelCatalog.open({ hosts: [] });
    await none.refresh();
    expect(fetched.mock.calls.map(([url]) => String(url))).toEqual([
      "https://models.dev/models.json",
    ]);
    const viaName = none.lookup("claude-sonnet-5", { host: "anthropic" });
    expect(viaName?.match).toBe("exact");
    expect(viaName?.cost).toBeUndefined();

    const some = await ModelCatalog.open({ hosts: ["anthropic"] });
    await some.refresh();
    expect(some.lookup("claude-sonnet-5", { host: "anthropic" })?.match).toBe("host");
    const unkeptHost = some.lookup("z-ai/glm-5.3-flash", { host: "openrouter" });
    expect(unkeptHost?.match).toBe("exact");
    expect(unkeptHost?.cost).toBeUndefined();
  });

  it("sends each layer's ETag and keeps the layer on 304", async () => {
    await writeCache(2 * DAY, { "acme/old": acmeModel }, { models: '"m0"', api: '"a0"' });
    const fetched = stubFetch({
      models: () => new Response(null, { status: 304 }),
      api: () => new Response(null, { status: 304 }),
    });
    const catalog = await ModelCatalog.open({ cachePath: CACHE_PATH });
    const before = catalog.fetchedAt!;

    await catalog.refresh();

    const headers = fetched.mock.calls.map(([, init]) => init.headers);
    expect(headers).toEqual([{ "If-None-Match": '"m0"' }, { "If-None-Match": '"a0"' }]);
    expect(catalog.contextWindow("acme/old")?.window).toBe(1234);
    expect(catalog.fetchedAt!.getTime()).toBeGreaterThan(before.getTime());
  });

  it("updates one layer while the other is unchanged", async () => {
    await writeCache(2 * DAY, { "acme/old": acmeModel }, { models: '"m0"' });
    stubFetch({
      models: () => new Response(null, { status: 304 }),
      api: await fixture("models-dev-api.json", { etag: '"a1"' }),
    });
    const catalog = await ModelCatalog.open({ cachePath: CACHE_PATH });

    await catalog.refresh();

    expect(catalog.contextWindow("acme/old")?.window).toBe(1234);
    expect(catalog.lookup("claude-sonnet-5", { host: "anthropic" })?.id).toBe(
      "anthropic/claude-sonnet-5",
    );
    expect(JSON.parse(await readFile(CACHE_PATH, "utf-8")).etags).toEqual({
      models: '"m0"',
      api: '"a1"',
    });
  });

  it("keeps the cache when the network fails or the server errors", async () => {
    await writeCache(2 * DAY, { "acme/old": acmeModel });
    for (const outcome of [
      () => new Error("offline"),
      () => new Response("nope", { status: 500 }),
    ]) {
      stubFetch({ models: outcome, api: outcome });
      const catalog = await ModelCatalog.open({ cachePath: CACHE_PATH });
      await expect(catalog.refresh()).resolves.toBeUndefined();
      expect(catalog.contextWindow("acme/old")?.window).toBe(1234);
    }
  });

  it("treats a corrupt or outdated cache file as empty and overwrites it on refresh", async () => {
    await mkdir(join(TEST_DIR, "cache"), { recursive: true });
    await writeFile(CACHE_PATH, JSON.stringify({ version: 1, contexts: { "acme/old": 1 } }));
    await stubBoth();
    const catalog = await ModelCatalog.open({ cachePath: CACHE_PATH });
    expect(catalog.size).toBe(0);

    await catalog.refresh();

    expect(catalog.size).toBe(14);
    expect(JSON.parse(await readFile(CACHE_PATH, "utf-8")).version).toBe(2);
  });

  it("reports stale by maxAge; refresh itself is unconditional", async () => {
    await writeCache(60_000, { "acme/old": acmeModel });
    const fetched = stubFetch({
      models: () => new Response(null, { status: 304 }),
      api: () => new Response(null, { status: 304 }),
    });

    expect((await ModelCatalog.open({ cachePath: CACHE_PATH, maxAge: 30_000 })).stale).toBe(true);

    const fresh = await ModelCatalog.open({ cachePath: CACHE_PATH, maxAge: 120_000 });
    expect(fresh.stale).toBe(false);
    await fresh.refresh();
    expect(fetched).toHaveBeenCalledTimes(2);
  });
});
