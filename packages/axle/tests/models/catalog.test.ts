import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogData } from "../../src/models/catalog.js";
import { ModelCatalog, parseCatalogData } from "../../src/models/catalog.js";
import { CatalogFetchError, fetchModelsDev } from "../../src/models/modelsDev.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");

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

const acmeModel = {
  name: "Acme",
  limit: { context: 1234 },
  reasoning: false,
  toolCall: true,
  attachment: false,
  modalities: { input: ["text"], output: ["text"] },
};

function previousData(overrides: Partial<CatalogData> = {}): CatalogData {
  return {
    version: 4,
    fetchedAt: "2026-10-01T00:00:00.000Z",
    etags: { models: '"m0"', api: '"a0"' },
    coverage: "all",
    models: { "acme/old": acmeModel },
    providers: { acme: { old: { canonical: "acme/old", cost: { input: 1, output: 1 } } } },
    ...overrides,
  };
}

function notModified(): Response {
  return new Response(null, { status: 304 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ModelCatalog.lookup", () => {
  let catalog: ModelCatalog;
  let data: CatalogData;

  beforeEach(async () => {
    await stubBoth();
    data = await fetchModelsDev();
    catalog = new ModelCatalog(data);
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
    expect(Object.keys(data.models)).toHaveLength(14);
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

describe("ModelCatalog", () => {
  it("reports when its data was fetched and which providers it covers", () => {
    const catalog = new ModelCatalog(previousData({ coverage: ["acme"] }));

    expect(catalog.fetchedAt).toBe("2026-10-01T00:00:00.000Z");
    expect(catalog.coverage).toEqual(["acme"]);
  });
});

describe("parseCatalogData", () => {
  it("reads saved data back", () => {
    const data = previousData();

    expect(parseCatalogData(JSON.stringify(data))).toEqual(data);
  });

  it("has no data for text that is not JSON, another version, or another shape", () => {
    const version3 = JSON.stringify({ ...previousData(), version: 3 });
    const shapeless = JSON.stringify({ version: 4, models: [] });

    for (const text of ["{", version3, shapeless]) {
      expect(parseCatalogData(text)).toBeUndefined();
    }
  });
});

describe("fetchModelsDev", () => {
  it("returns slimmed two-layer data with each layer's ETag", async () => {
    const fetched = await stubBoth();

    const data = await fetchModelsDev();

    expect(fetched).toHaveBeenCalledTimes(2);
    expect(data.version).toBe(4);
    expect(data.coverage).toBe("all");
    expect(data.etags).toEqual({ models: '"m1"', api: '"a1"' });
    expect(data.models["anthropic/claude-sonnet-5"].limit.context).toBe(1_000_000);
    expect(data.models["anthropic/claude-sonnet-5"]).not.toHaveProperty("benchmarks");
    expect(data.providers.openrouter["z-ai/glm-5.3-flash"]).toMatchObject({
      canonical: "zhipuai/glm-5.3-flash",
    });
    expect(data.providers.openrouter["z-ai/glm-5.3-flash"]).not.toHaveProperty("model");
    expect(data.providers.togetherai["zai-org/GLM-5.1"]).not.toHaveProperty("canonical");
    expect(data.providers.togetherai["zai-org/GLM-5.1"].model?.name).toBe("GLM-5.1");
    expect(
      new ModelCatalog(JSON.parse(JSON.stringify(data))).contextWindow("openai/gpt-5")?.window,
    ).toBe(400_000);
  });

  it("providers: [] skips api.json; providers: [...] keeps only those", async () => {
    const fetched = await stubBoth();

    const none = await fetchModelsDev({ providers: [] });
    expect(fetched.mock.calls.map(([url]) => String(url))).toEqual([
      "https://models.dev/models.json",
    ]);
    expect(none.providers).toEqual({});
    expect(none.coverage).toEqual([]);
    const viaName = new ModelCatalog(none).lookup("claude-sonnet-5", { provider: "anthropic" });
    expect(viaName?.match).toBe("exact");
    expect(viaName?.cost).toBeUndefined();

    const some = await fetchModelsDev({ providers: ["anthropic"] });
    expect(Object.keys(some.providers)).toEqual(["anthropic"]);
    expect(some.coverage).toEqual(["anthropic"]);
  });

  it("sends the previous ETags, keeps a layer models.dev reports unchanged, and stamps a new fetchedAt", async () => {
    const fetched = stubFetch({ models: notModified, api: notModified });
    const previous = previousData();

    const data = await fetchModelsDev({ previous });

    const headers = fetched.mock.calls.map(([, init]) => init.headers);
    expect(headers).toEqual([{ "If-None-Match": '"m0"' }, { "If-None-Match": '"a0"' }]);
    expect(data.models).toEqual(previous.models);
    expect(data.providers).toEqual(previous.providers);
    expect(data.etags).toEqual(previous.etags);
    expect(Date.parse(data.fetchedAt)).toBeGreaterThan(Date.parse(previous.fetchedAt));
  });

  it("updates one layer while the other is unchanged", async () => {
    stubFetch({
      models: notModified,
      api: await fixture("models-dev-api.json", { etag: '"a1"' }),
    });

    const data = await fetchModelsDev({ previous: previousData() });

    expect(data.models).toEqual({ "acme/old": acmeModel });
    expect(data.providers.anthropic).toBeDefined();
    expect(data.providers.acme).toBeUndefined();
    expect(data.etags).toEqual({ models: '"m0"', api: '"a1"' });
  });

  it("refetches the provider layer when the previous data covers other providers", async () => {
    const fetched = stubFetch({
      models: notModified,
      api: await fixture("models-dev-api.json", { etag: '"a1"' }),
    });

    const data = await fetchModelsDev({
      providers: ["anthropic"],
      previous: previousData({ coverage: ["acme"] }),
    });

    expect(fetched.mock.calls.map(([, init]) => init.headers)).toEqual([
      { "If-None-Match": '"m0"' },
      {},
    ]);
    expect(Object.keys(data.providers)).toEqual(["anthropic"]);
  });

  it.each([
    ["a network failure", () => new Error("offline")],
    ["a server error", () => new Response("nope", { status: 500 })],
    ["a body that is not JSON", () => new Response("<html>", { status: 200 })],
    ["a body of the wrong shape", () => new Response('"nope"', { status: 200 })],
  ])("rejects with a CatalogFetchError on %s, with no partial result", async (_, outcome) => {
    stubFetch({ models: await fixture("models-dev.json"), api: outcome });

    await expect(fetchModelsDev()).rejects.toBeInstanceOf(CatalogFetchError);
  });

  it("rejects when the fetch outlasts the timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(
          (_url: string, init: RequestInit) =>
            new Promise((_, reject) =>
              init.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
            ),
        ),
    );

    await expect(fetchModelsDev({ timeout: 10 })).rejects.toBeInstanceOf(CatalogFetchError);
  });
});
