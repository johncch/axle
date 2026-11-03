import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogData } from "../../src/models/catalog.js";
import { catalogFile, ModelCatalogStore } from "../../src/models/store.js";

const DAY = 24 * 60 * 60 * 1000;
const TEST_DIR = join(import.meta.dirname, "__store_tmp__");

const acme = {
  name: "Acme",
  limit: { context: 1234 },
  reasoning: false,
  toolCall: true,
  attachment: false,
  modalities: { input: ["text"], output: ["text"] },
};

function savedJson(ageMs: number): string {
  const data: CatalogData = {
    version: 4,
    fetchedAt: new Date(Date.now() - ageMs).toISOString(),
    etags: { models: '"m0"' },
    coverage: "all",
    models: { "acme/old": acme },
    providers: {},
  };
  return JSON.stringify(data);
}

const fresh = {
  "acme/new": {
    name: "New",
    limit: { context: 5678 },
    reasoning: false,
    tool_call: true,
    attachment: false,
    modalities: { input: ["text"], output: ["text"] },
  },
};

function online() {
  const mock = vi
    .fn()
    .mockImplementation((url: string) =>
      Promise.resolve(
        new Response(JSON.stringify(url.endsWith("/models.json") ? fresh : {}), { status: 200 }),
      ),
    );
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("ModelCatalogStore", () => {
  it("has no current catalog until it loads or refreshes", () => {
    expect(new ModelCatalogStore().current).toBeUndefined();
  });

  it("loads saved JSON as current and ignores what it cannot use", () => {
    const store = new ModelCatalogStore();
    store.load(savedJson(60_000));
    expect(store.current?.contextWindow("acme/old")?.window).toBe(1234);

    for (const unusable of [undefined, "{", JSON.stringify({ version: 3 })]) {
      store.load(unusable);
      expect(store.current?.contextWindow("acme/old")?.window).toBe(1234);
    }
  });

  it("refreshes from models.dev with the current data's ETags and makes the result current", async () => {
    const fetched = online();
    const store = new ModelCatalogStore();
    store.load(savedJson(2 * DAY));

    const snapshot = await store.refresh();

    expect(snapshot).toBe(store.snapshot());
    expect(fetched.mock.calls[0][1].headers).toEqual({ "If-None-Match": '"m0"' });
    expect(store.current?.contextWindow("acme/new")?.window).toBe(5678);
  });

  it("keeps the current catalog and resolves false when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const store = new ModelCatalogStore();
    store.load(savedJson(2 * DAY));

    expect(await store.refresh()).toBeUndefined();

    expect(store.current?.contextWindow("acme/old")?.window).toBe(1234);
  });

  it("refreshIfStale fetches only past maxAge, or with no data", async () => {
    const fetched = online();
    const store = new ModelCatalogStore({ maxAge: 30_000 });
    store.load(savedJson(10_000));

    expect(await store.refreshIfStale()).toBeUndefined();
    expect(fetched).not.toHaveBeenCalled();

    expect(await new ModelCatalogStore().refreshIfStale()).toBeDefined();
    store.load(savedJson(60_000));
    expect(await store.refreshIfStale()).toBeDefined();
  });

  it("shares one fetch between concurrent refreshes", async () => {
    const fetched = online();
    const store = new ModelCatalogStore();

    const [first, second] = await Promise.all([store.refresh(), store.refresh()]);

    expect(first).toBeDefined();
    expect(second).toBe(first);
    // one fetch is two requests, models.json and api.json
    expect(fetched).toHaveBeenCalledTimes(2);
    await store.refresh();
    expect(fetched).toHaveBeenCalledTimes(4);
  });

  it("snapshots the current data as JSON that loads back", async () => {
    online();
    const store = new ModelCatalogStore();
    expect(store.snapshot()).toBeUndefined();
    await store.refresh();

    const restored = new ModelCatalogStore();
    restored.load(store.snapshot());

    expect(restored.current?.contextWindow("acme/new")?.window).toBe(5678);
  });
});

describe("catalogFile", () => {
  it("reads a missing file as none and creates the directory on write", async () => {
    const path = join(TEST_DIR, "cache", "models.json");
    const file = catalogFile(path);

    expect(await file.read()).toBeUndefined();
    await file.write('{"x":1}');
    expect(await readFile(path, "utf-8")).toBe('{"x":1}');
    expect(await file.read()).toBe('{"x":1}');
  });

  it("leaves no temporary file behind when the write fails", async () => {
    await mkdir(join(TEST_DIR, "dir-not-file"), { recursive: true });
    const file = catalogFile(join(TEST_DIR, "dir-not-file"));

    await expect(file.write("{}")).rejects.toThrow();
    await expect(readFile(join(TEST_DIR, "dir-not-file.tmp"))).rejects.toThrow();
  });
});
