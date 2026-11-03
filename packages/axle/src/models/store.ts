import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CatalogData } from "./catalog.js";
import { ModelCatalog, parseCatalogData } from "./catalog.js";
import type { FetchModelsDevOptions } from "./modelsDev.js";
import { CatalogFetchError, fetchModelsDev } from "./modelsDev.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ModelCatalogStoreOptions extends Omit<FetchModelsDevOptions, "previous"> {
  /** Age in milliseconds past which `refreshIfStale()` fetches. Defaults to one day. */
  maxAge?: number;
}

/**
 * Holds the current `ModelCatalog` and moves it through its stages, each one
 * a call the host makes: `load` the saved JSON, `refresh` from models.dev,
 * read `current`, and `snapshot` the data to save. The store never touches
 * storage. `current` is `undefined` until a load or refresh gives it data, and
 * a refresh that lands replaces it. Concurrent `refresh` calls share one
 * fetch.
 *
 * @experimental The catalog API is new in 0.35 and may change in a minor release.
 */
export class ModelCatalogStore {
  private readonly options: ModelCatalogStoreOptions;
  private data: CatalogData | undefined;
  private catalog: ModelCatalog | undefined;
  private refreshing: Promise<string | undefined> | undefined;

  constructor(options: ModelCatalogStoreOptions = {}) {
    this.options = options;
  }

  get current(): ModelCatalog | undefined {
    return this.catalog;
  }

  /** Take saved JSON as the current data; text that is not usable `CatalogData` is ignored. */
  load(json: string | undefined): void {
    const data = json === undefined ? undefined : parseCatalogData(json);
    if (data) this.set(data);
  }

  /**
   * Fetch models.dev, sending the current data's ETags, and make the result
   * current. Resolves the new snapshot to save, or `undefined` when the fetch
   * failed; never rejects for the network. A call while a refresh is in
   * flight joins it.
   */
  refresh(): Promise<string | undefined> {
    this.refreshing ??= this.fetch().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  /** `refresh()` when there is no data or it is older than `maxAge`; otherwise resolves `undefined`. */
  refreshIfStale(): Promise<string | undefined> {
    return this.isStale() ? this.refresh() : Promise.resolve(undefined);
  }

  /** The current data as JSON, to save and `load` later; `undefined` when there is none. */
  snapshot(): string | undefined {
    return this.data && JSON.stringify(this.data);
  }

  private isStale(): boolean {
    const maxAge = this.options.maxAge ?? DAY_MS;
    return !this.data || Date.now() - Date.parse(this.data.fetchedAt) >= maxAge;
  }

  private async fetch(): Promise<string | undefined> {
    const { maxAge: _, ...fetchOptions } = this.options;
    let data: CatalogData;
    try {
      data = await fetchModelsDev({ ...fetchOptions, previous: this.data });
    } catch (e) {
      if (e instanceof CatalogFetchError) return undefined;
      throw e;
    }
    this.set(data);
    return JSON.stringify(data);
  }

  private set(data: CatalogData): void {
    this.data = data;
    this.catalog = new ModelCatalog(data);
  }
}

/** JSON text saved somewhere: a file, a database row, an object store. */
export interface CatalogStorage {
  /** The saved JSON, or `undefined` when there is none. */
  read(): Promise<string | undefined>;
  write(json: string): Promise<void>;
}

/** `CatalogStorage` in a file, written atomically; a missing or unreadable file reads as none. */
export function catalogFile(path: string): CatalogStorage {
  return {
    async read() {
      try {
        return await readFile(path, "utf-8");
      } catch {
        return undefined;
      }
    },
    async write(json) {
      const tmpPath = `${path}.tmp`;
      await mkdir(dirname(path), { recursive: true });
      try {
        await writeFile(tmpPath, json);
        await rename(tmpPath, path);
      } catch (e) {
        await rm(tmpPath, { force: true }).catch(() => {});
        throw e;
      }
    },
  };
}
