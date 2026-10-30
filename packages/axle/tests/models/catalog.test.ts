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
      version: 3,
      fetchedAt: new Date(Date.now() - ageMs).toISOString(),
      etags,
      models,
      providers: {},
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
    catalog = ModelCatalog.open({ cachePath: CACHE_PATH });
    await catalog.ready;
  });

  it("matches a provider's own id and returns the provider's limits and prices", () => {
    const found = catalog.lookup("z-ai/glm-5.3-flash", { provider: "openrouter" });
    expect(found).toMatchObject({
      id: "zhipuai/glm-5.3-flash",
      match: "provider",
      model: { name: "GLM-5.3-Flash", limit: { context: 1_048_576, output: 943_717 } },
      cost: { input: 0.15, output: 0.5, cacheRead: 0.03 },
    });
    expect(found?.model.toolCall).toBe(true);
  });

  it("qualifies a first-party provider id into the canonical key", () => {
    expect(catalog.lookup("claude-sonnet-5", { provider: "anthropic" })).toMatchObject({
      id: "anthropic/claude-sonnet-5",
      match: "provider",
      model: { limit: { context: 1_000_000, output: 128_000 } },
      cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
    });
  });

  it("matches a publisher-qualified id against a first-party provider by its model part", () => {
    expect(catalog.lookup("anthropic/claude-sonnet-5", { provider: "anthropic" })).toMatchObject({
      id: "anthropic/claude-sonnet-5",
      match: "provider",
      cost: { input: 2, output: 10 },
    });
    const otherPublisher = catalog.lookup("openai/claude-sonnet-5", { provider: "anthropic" });
    expect(otherPublisher?.match).toBe("exact");
    expect(otherPublisher?.cost).toBeUndefined();
  });

  it("carries context-size price tiers", () => {
    const found = catalog.lookup("gemini-2.5-pro", { provider: "google" });
    expect(found?.cost).toMatchObject({ input: 1.25, output: 10, cacheRead: 0.125 });
    expect(found?.cost?.tiers).toEqual([
      { size: 200_000, input: 2.5, output: 15, cacheRead: 0.25 },
    ]);
    expect(
      catalog.lookup("claude-sonnet-5", { provider: "anthropic" })?.cost?.tiers,
    ).toBeUndefined();
  });

  it("keeps a provider-only model's record when the catalog has no canonical entry", () => {
    expect(catalog.lookup("zai-org/GLM-5.1", { provider: "togetherai" })).toMatchObject({
      id: "togetherai/zai-org/GLM-5.1",
      match: "provider",
      model: { limit: { context: 202_752 } },
      cost: { input: 1.4, output: 4.4 },
    });
    expect(
      catalog.lookup("sao10k/l3-lunaris-8b", { provider: "openrouter" })?.model.limit.context,
    ).toBe(8192);
  });

  it("ignores case in a provider id", () => {
    expect(catalog.lookup("zai-org/glm-5.1", { provider: "togetherai" })?.match).toBe("provider");
  });

  it("falls through to the canonical layer for an unknown provider or id", () => {
    expect(catalog.lookup("anthropic/claude-sonnet-5", { provider: "nowhere" })).toMatchObject({
      id: "anthropic/claude-sonnet-5",
      match: "exact",
    });
    expect(catalog.lookup("anthropic/claude-sonnet-5", { provider: "openrouter" })?.match).toBe(
      "exact",
    );
    expect(
      catalog.lookup("anthropic/claude-sonnet-5", { provider: "openrouter" })?.cost,
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

  it("matches a publisher slug by its model part when no provider is given", () => {
    expect(catalog.lookup("z-ai/glm-4.7-flash")?.id).toBe("zhipuai/glm-4.7-flash");
  });

  it("gives up when more than one entry shares the prefix", () => {
    expect(catalog.lookup("gemma3:latest")).toBeUndefined();
    expect(catalog.lookup("gemma4")).toBeUndefined();
  });

  it("treats a zero limit as unknown and drops a malformed entry without failing the file", () => {
    expect(catalog.size).toBe(14);
    expect(catalog.lookup("bytedance-seed/seedance-2.0")).toBeUndefined();
    expect(catalog.lookup("acme/broken")).toBeUndefined();
    expect(catalog.lookup("acme/zero-output", { provider: "openrouter" })?.model.limit).toEqual({
      context: 4096,
    });
    expect(catalog.lookup("acme/broken", { provider: "openrouter" })).toBeUndefined();
  });

  it("gives up on a name the catalog lacks", () => {
    expect(catalog.lookup("totally-unknown")).toBeUndefined();
    expect(catalog.lookup("acme/unknown")).toBeUndefined();
    expect(catalog.lookup("acme/unknown", { provider: "openrouter" })).toBeUndefined();
  });
});

describe("ModelCatalog cache", () => {
  it("is unavailable when there is no cache and the fetch fails", async () => {
    stubFetch({ models: () => new Error("offline"), api: () => new Error("offline") });
    const catalog = ModelCatalog.open({ cachePath: CACHE_PATH, retryDelays: [] });
    await catalog.ready;

    expect(catalog.state).toEqual({ status: "unavailable" });
    expect(catalog.size).toBe(0);
    expect(catalog.contextWindow("anthropic/claude-sonnet-5")).toBeUndefined();
  });

  it("is loading without a cache until the fetch lands, and tells listeners", async () => {
    const models = await fixture("models-dev.json");
    const api = await fixture("models-dev-api.json");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation((url: string) =>
          gate.then(() => (url.endsWith("/models.json") ? models() : api())),
        ),
    );
    const catalog = ModelCatalog.open({ cachePath: CACHE_PATH });
    const changes: string[] = [];
    catalog.onChange(() => changes.push(catalog.state.status));

    expect(catalog.state).toEqual({ status: "loading" });
    expect(catalog.lookup("claude-sonnet-5", { provider: "anthropic" })).toBeUndefined();

    release();
    await catalog.ready;

    expect(catalog.state).toMatchObject({ status: "loaded", stale: false });
    expect(catalog.lookup("claude-sonnet-5", { provider: "anthropic" })?.match).toBe("provider");
    expect(changes).toEqual(["loaded"]);
  });

  it("retries an unavailable catalog after each delay", async () => {
    stubFetch({ models: () => new Error("offline"), api: () => new Error("offline") });
    const catalog = ModelCatalog.open({
      cachePath: CACHE_PATH,
      retryDelays: Array<number>(50).fill(10),
    });
    await catalog.ready;
    expect(catalog.state).toEqual({ status: "unavailable" });
    const changes: string[] = [];
    const untilStatus = (status: string) =>
      new Promise<void>((resolve) => {
        const off = catalog.onChange(() => {
          changes.push(catalog.state.status);
          if (catalog.state.status === status) {
            off();
            resolve();
          }
        });
      });

    await untilStatus("unavailable");
    expect(changes.slice(0, 2)).toEqual(["loading", "unavailable"]);

    await stubBoth();
    await untilStatus("loaded");

    expect(catalog.size).toBe(14);
    expect(changes.slice(-2)).toEqual(["loading", "loaded"]);
  });

  it("keeps a fetched catalog in memory when the cache cannot be written", async () => {
    await stubBoth();
    await writeFile(join(TEST_DIR, "not-a-dir"), "");
    const catalog = ModelCatalog.open({
      cachePath: join(TEST_DIR, "not-a-dir", "models.json"),
    });
    await catalog.ready;

    expect(catalog.state).toMatchObject({ status: "loaded" });
    expect(catalog.size).toBe(14);
  });

  it("open fetches a missing cache and writes a slimmed two-layer file that a later open reads without fetching", async () => {
    const fetched = await stubBoth();
    const catalog = ModelCatalog.open({ cachePath: CACHE_PATH });
    await catalog.ready;
    expect(fetched).toHaveBeenCalledTimes(2);

    const file = JSON.parse(await readFile(CACHE_PATH, "utf-8"));
    expect(file.version).toBe(3);
    expect(file.etags).toEqual({ models: '"m1"', api: '"a1"' });
    expect(file.models["anthropic/claude-sonnet-5"].limit.context).toBe(1_000_000);
    expect(file.models["anthropic/claude-sonnet-5"]).not.toHaveProperty("benchmarks");
    expect(file.providers.openrouter["z-ai/glm-5.3-flash"]).toMatchObject({
      canonical: "zhipuai/glm-5.3-flash",
    });
    expect(file.providers.openrouter["z-ai/glm-5.3-flash"]).not.toHaveProperty("model");
    expect(file.providers.togetherai["zai-org/GLM-5.1"]).not.toHaveProperty("canonical");
    expect(file.providers.togetherai["zai-org/GLM-5.1"].model.name).toBe("GLM-5.1");
    expect(catalog.size).toBe(14);

    fetched.mockClear();
    const reopened = ModelCatalog.open({ cachePath: CACHE_PATH });
    expect(reopened.state).toEqual({ status: "loading" });
    await reopened.ready;
    expect(fetched).not.toHaveBeenCalled();
    expect(reopened.state).toMatchObject({ status: "loaded", stale: false });
    expect(reopened.contextWindow("openai/gpt-5")?.window).toBe(400_000);
    expect(reopened.lookup("claude-sonnet-5", { provider: "anthropic" })?.cost?.input).toBe(2);
  });

  it("holds the catalog in memory when no cachePath is given", async () => {
    await stubBoth();
    const catalog = ModelCatalog.open();
    await catalog.ready;

    expect(catalog.size).toBe(14);
    expect(catalog.lookup("z-ai/glm-5.3-flash", { provider: "openrouter" })?.match).toBe(
      "provider",
    );
    await expect(stat(CACHE_PATH)).rejects.toThrow();
  });

  it("providers: [] skips api.json; providers: [...] keeps only those", async () => {
    const fetched = await stubBoth();
    const none = ModelCatalog.open({ providers: [] });
    await none.ready;
    expect(fetched.mock.calls.map(([url]) => String(url))).toEqual([
      "https://models.dev/models.json",
    ]);
    const viaName = none.lookup("claude-sonnet-5", { provider: "anthropic" });
    expect(viaName?.match).toBe("exact");
    expect(viaName?.cost).toBeUndefined();

    const some = ModelCatalog.open({ providers: ["anthropic"] });
    await some.ready;
    expect(some.lookup("claude-sonnet-5", { provider: "anthropic" })?.match).toBe("provider");
    const unkeptProvider = some.lookup("z-ai/glm-5.3-flash", { provider: "openrouter" });
    expect(unkeptProvider?.match).toBe("exact");
    expect(unkeptProvider?.cost).toBeUndefined();
  });

  it("refreshes a stale cache on open, sending each layer's ETag and keeping the layer on 304", async () => {
    await writeCache(2 * DAY, { "acme/old": acmeModel }, { models: '"m0"', api: '"a0"' });
    const fetched = stubFetch({
      models: () => new Response(null, { status: 304 }),
      api: () => new Response(null, { status: 304 }),
    });
    const catalog = ModelCatalog.open({ cachePath: CACHE_PATH });
    await catalog.ready;
    const before = catalog.state;
    expect(before).toMatchObject({ status: "loaded", stale: true });
    expect(fetched).toHaveBeenCalledTimes(2);

    await catalog.refresh();

    const headers = fetched.mock.calls.slice(0, 2).map(([, init]) => init.headers);
    expect(headers).toEqual([{ "If-None-Match": '"m0"' }, { "If-None-Match": '"a0"' }]);
    expect(catalog.contextWindow("acme/old")?.window).toBe(1234);
    const after = catalog.state;
    if (before.status !== "loaded" || after.status !== "loaded") throw new Error("not loaded");
    expect(Date.parse(after.fetchedAt)).toBeGreaterThan(Date.parse(before.fetchedAt));
    expect(after.stale).toBe(false);
  });

  it("updates one layer while the other is unchanged", async () => {
    await writeCache(2 * DAY, { "acme/old": acmeModel }, { models: '"m0"' });
    stubFetch({
      models: () => new Response(null, { status: 304 }),
      api: await fixture("models-dev-api.json", { etag: '"a1"' }),
    });
    const catalog = ModelCatalog.open({ cachePath: CACHE_PATH });

    await catalog.ready;
    await catalog.refresh();

    expect(catalog.contextWindow("acme/old")?.window).toBe(1234);
    expect(catalog.lookup("claude-sonnet-5", { provider: "anthropic" })?.id).toBe(
      "anthropic/claude-sonnet-5",
    );
    expect(JSON.parse(await readFile(CACHE_PATH, "utf-8")).etags).toEqual({
      models: '"m0"',
      api: '"a1"',
    });
  });

  it("stays stale after a partial refresh so the failed layer is retried", async () => {
    await writeCache(2 * DAY, { "acme/old": acmeModel }, { models: '"m0"' });
    stubFetch({
      models: () => new Response(null, { status: 304 }),
      api: () => new Error("offline"),
    });
    const catalog = ModelCatalog.open({ cachePath: CACHE_PATH });
    await catalog.ready;
    const before = catalog.state;

    await catalog.refresh();

    expect(catalog.state).toEqual(before);
    expect(catalog.state).toMatchObject({ status: "loaded", stale: true });
    expect(catalog.contextWindow("acme/old")?.window).toBe(1234);

    stubFetch({ models: await fixture("models-dev.json"), api: () => new Error("offline") });
    const fresh = ModelCatalog.open();
    await fresh.ready;
    expect(fresh.size).toBe(14);
    expect(fresh.state).toMatchObject({ status: "loaded", stale: true });
  });

  it("keeps the cache when the network fails or the server errors", async () => {
    await writeCache(2 * DAY, { "acme/old": acmeModel });
    for (const outcome of [
      () => new Error("offline"),
      () => new Response("nope", { status: 500 }),
    ]) {
      stubFetch({ models: outcome, api: outcome });
      const catalog = ModelCatalog.open({ cachePath: CACHE_PATH });
      await catalog.ready;
      await expect(catalog.refresh()).resolves.toBeUndefined();
      expect(catalog.contextWindow("acme/old")?.window).toBe(1234);
    }
  });

  it("treats a corrupt or outdated cache file as empty and overwrites it on refresh", async () => {
    await mkdir(join(TEST_DIR, "cache"), { recursive: true });
    await writeFile(CACHE_PATH, JSON.stringify({ version: 1, contexts: { "acme/old": 1 } }));
    const fetched = await stubBoth();
    const catalog = ModelCatalog.open({ cachePath: CACHE_PATH });

    await catalog.ready;

    expect(fetched).toHaveBeenCalledTimes(2);
    expect(catalog.size).toBe(14);
    expect(JSON.parse(await readFile(CACHE_PATH, "utf-8")).version).toBe(3);
  });

  it("reports stale by maxAge; refresh itself is unconditional", async () => {
    await writeCache(60_000, { "acme/old": acmeModel });
    const fetched = stubFetch({
      models: () => new Response(null, { status: 304 }),
      api: () => new Response(null, { status: 304 }),
    });

    const stale = ModelCatalog.open({ cachePath: CACHE_PATH, maxAge: 30_000 });
    await stale.ready;
    expect(stale.state).toMatchObject({ status: "loaded", stale: true });
    expect(fetched).toHaveBeenCalledTimes(2);

    fetched.mockClear();
    const fresh = ModelCatalog.open({ cachePath: CACHE_PATH, maxAge: 120_000 });
    await fresh.ready;
    expect(fresh.state).toMatchObject({ status: "loaded", stale: false });
    expect(fetched).not.toHaveBeenCalled();
    await fresh.refresh();
    expect(fetched).toHaveBeenCalledTimes(2);
  });
});
