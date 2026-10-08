import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { splitModelId } from "../providers/model.js";

const MODELS_DEV_URL = "https://models.dev";
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

const CatalogModelSchema = z.object({
  name: z.string(),
  limit: z.object({
    context: z.number().int().positive(),
    output: z.number().int().positive().optional(),
    input: z.number().int().positive().optional(),
  }),
  reasoning: z.boolean(),
  toolCall: z.boolean(),
  structuredOutput: z.boolean().optional(),
  attachment: z.boolean(),
  modalities: z.object({ input: z.array(z.string()), output: z.array(z.string()) }),
  knowledge: z.string().optional(),
});

const ModelCostSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional(),
  reasoning: z.number().optional(),
});

const HostEntrySchema = z.object({
  canonical: z.string().optional(),
  model: CatalogModelSchema.optional(),
  limit: CatalogModelSchema.shape.limit.partial().optional(),
  cost: ModelCostSchema.optional(),
});

const CacheFileSchema = z.object({
  version: z.literal(2),
  fetchedAt: z.string(),
  etags: z.object({ models: z.string().optional(), api: z.string().optional() }),
  models: z.record(z.string(), CatalogModelSchema),
  hosts: z.record(z.string(), z.record(z.string(), HostEntrySchema)),
});

type CacheFile = z.infer<typeof CacheFileSchema>;
type HostEntry = z.infer<typeof HostEntrySchema>;

const ModelsDevEntrySchema = z.looseObject({
  name: z.string(),
  limit: z
    .looseObject({
      context: z.number().int().positive().optional(),
      output: z.number().int().positive().optional(),
      input: z.number().int().positive().optional(),
    })
    .optional(),
  reasoning: z.boolean(),
  tool_call: z.boolean(),
  structured_output: z.boolean().optional(),
  attachment: z.boolean(),
  modalities: z.looseObject({ input: z.array(z.string()), output: z.array(z.string()) }),
  knowledge: z.string().optional(),
  cost: z
    .looseObject({
      input: z.number(),
      output: z.number(),
      cache_read: z.number().optional(),
      cache_write: z.number().optional(),
      reasoning: z.number().optional(),
    })
    .optional(),
  canonical_model_id: z.string().optional(),
});

type ModelsDevEntry = z.infer<typeof ModelsDevEntrySchema>;

const ModelsDevModelsSchema = z.record(z.string(), ModelsDevEntrySchema);
const ModelsDevApiSchema = z.record(
  z.string(),
  z.looseObject({ models: z.record(z.string(), ModelsDevEntrySchema) }),
);

/** What the catalog records about a model, independent of who serves it. */
export type CatalogModel = z.infer<typeof CatalogModelSchema>;

/** Price per million tokens, as the host charges it. */
export type ModelCost = z.infer<typeof ModelCostSchema>;

export interface CatalogMatch {
  /** The canonical `publisher/model` id, or `host/id` for a model only that host lists. */
  id: string;
  /** `host`: the host's own id matched exactly; `exact`/`prefix`: matched by canonical id or name. */
  match: "host" | "exact" | "prefix";
  model: CatalogModel;
  /** Present only for a host match. */
  cost?: ModelCost;
}

export interface ContextWindowMatch {
  window: number;
  id: string;
  match: CatalogMatch["match"];
}

export interface ModelCatalogOptions {
  /** Where the slimmed catalog is kept between runs; omit to hold it in memory only. */
  cachePath?: string;
  /** Age in milliseconds past which the catalog reports itself `stale`. Defaults to one day. */
  maxAge?: number;
  /**
   * models.dev provider ids whose own model ids to keep (`anthropic`, `openrouter`,
   * `togetherai`, …). Omit for every host; `[]` skips the per-host catalog entirely.
   */
  hosts?: string[];
  /** Catalog origin; defaults to models.dev. */
  baseUrl?: string;
}

/**
 * Model metadata looked up from the models.dev catalog: a canonical layer
 * (`publisher/model`, host-independent) and a per-host layer (each host's
 * own ids with its limits and prices, linked to the canonical entry).
 *
 * `open()` reads the cache and never touches the network; `refresh()`
 * always fetches, sending ETags so an unchanged catalog downloads nothing,
 * and never throws — a failed fetch keeps the cached copy. `stale` says
 * whether the cache is older than `maxAge`; when to refresh is the host's
 * call.
 *
 * `lookup()` tries the host's own id first when a host is given, then the
 * canonical key, then a best-effort match for local runtimes' names
 * (`gemma4:26b-mlx`): trailing build tags dropped, punctuation and case
 * ignored, publisher ignored, exact normalized match first, else a unique
 * prefix.
 */
export class ModelCatalog {
  private readonly cachePath: string | undefined;
  private readonly maxAge: number;
  private readonly hosts: string[] | undefined;
  private readonly baseUrl: string;
  private cache: CacheFile | undefined;
  private normalized: { id: string; key: string }[] = [];

  private constructor(options: ModelCatalogOptions, cache: CacheFile | undefined) {
    this.cachePath = options.cachePath;
    this.maxAge = options.maxAge ?? DEFAULT_MAX_AGE_MS;
    this.hosts = options.hosts;
    this.baseUrl = options.baseUrl ?? MODELS_DEV_URL;
    this.setCache(cache);
  }

  static async open(options: ModelCatalogOptions = {}): Promise<ModelCatalog> {
    let cache: CacheFile | undefined;
    if (options.cachePath) {
      try {
        const parsed = CacheFileSchema.safeParse(
          JSON.parse(await readFile(options.cachePath, "utf-8")),
        );
        if (parsed.success) cache = parsed.data;
      } catch {
        cache = undefined;
      }
    }
    return new ModelCatalog(options, cache);
  }

  get size(): number {
    return this.normalized.length;
  }

  get fetchedAt(): Date | undefined {
    return this.cache ? new Date(this.cache.fetchedAt) : undefined;
  }

  get stale(): boolean {
    return !this.cache || Date.now() - Date.parse(this.cache.fetchedAt) >= this.maxAge;
  }

  async refresh(): Promise<void> {
    const wantHosts = this.hosts === undefined || this.hosts.length > 0;
    const [modelsResult, apiResult] = await Promise.all([
      this.fetchLayer("/models.json", this.cache?.etags.models),
      wantHosts ? this.fetchLayer("/api.json", this.cache?.etags.api) : Promise.resolve(undefined),
    ]);
    if (modelsResult === undefined && apiResult === undefined) return;
    const complete = modelsResult !== undefined && (!wantHosts || apiResult !== undefined);

    let models = this.cache?.models ?? {};
    let etagModels = this.cache?.etags.models;
    if (modelsResult && modelsResult.body !== undefined) {
      const parsed = ModelsDevModelsSchema.safeParse(modelsResult.body);
      if (!parsed.success) return;
      models = {};
      for (const [id, entry] of Object.entries(parsed.data)) {
        const model = toCatalogModel(entry);
        if (model) models[id] = model;
      }
      etagModels = modelsResult.etag;
    }

    let hosts = this.cache?.hosts ?? {};
    let etagApi = this.cache?.etags.api;
    if (!wantHosts) {
      hosts = {};
      etagApi = undefined;
    } else if (apiResult && apiResult.body !== undefined) {
      const parsed = ModelsDevApiSchema.safeParse(apiResult.body);
      if (!parsed.success) return;
      hosts = {};
      for (const [host, provider] of Object.entries(parsed.data)) {
        if (this.hosts && !this.hosts.includes(host)) continue;
        hosts[host] = {};
        for (const [id, entry] of Object.entries(provider.models)) {
          hosts[host][id] = toHostEntry(host, id, entry, models);
        }
      }
      etagApi = apiResult.etag;
    }

    try {
      await this.writeCache({
        version: 2,
        fetchedAt: complete
          ? new Date().toISOString()
          : (this.cache?.fetchedAt ?? new Date(0).toISOString()),
        etags: { models: etagModels, api: etagApi },
        models,
        hosts,
      });
    } catch {
      return;
    }
  }

  lookup(model: string, options?: { host?: string; publisher?: string }): CatalogMatch | undefined {
    if (!this.cache) return undefined;
    const { publisher, name } = splitModelId(model);

    if (options?.host) {
      const entries = this.cache.hosts[options.host];
      const publisherIsHost = publisher === options.host.toLowerCase();
      const hostId = entries
        ? (findKey(entries, model) ?? (publisherIsHost ? findKey(entries, name) : undefined))
        : undefined;
      if (entries && hostId !== undefined) {
        const entry = entries[hostId];
        const base = entry.canonical ? this.cache.models[entry.canonical] : entry.model;
        if (base) {
          return {
            id: entry.canonical ?? `${options.host}/${hostId}`,
            match: "host",
            model: { ...base, limit: { ...base.limit, ...entry.limit } },
            cost: entry.cost,
          };
        }
      }
    }

    const qualified =
      publisher === undefined
        ? options?.publisher
          ? `${options.publisher}/${model}`
          : undefined
        : model;
    if (qualified) {
      const id = findKey(this.cache.models, qualified);
      if (id !== undefined) return { id, match: "exact", model: this.cache.models[id] };
    }

    const key = normalizeModelName(name);
    if (key.length === 0) return undefined;
    const exact = this.normalized.filter((entry) => entry.key === key);
    if (exact.length === 1) {
      return { id: exact[0].id, match: "exact", model: this.cache.models[exact[0].id] };
    }
    if (exact.length > 1) return undefined;
    const prefixed = this.normalized.filter((entry) => entry.key.startsWith(key));
    if (prefixed.length === 1) {
      return { id: prefixed[0].id, match: "prefix", model: this.cache.models[prefixed[0].id] };
    }
    return undefined;
  }

  contextWindow(
    model: string,
    options?: { host?: string; publisher?: string },
  ): ContextWindowMatch | undefined {
    const found = this.lookup(model, options);
    return found
      ? { window: found.model.limit.context, id: found.id, match: found.match }
      : undefined;
  }

  private async fetchLayer(
    path: string,
    etag: string | undefined,
  ): Promise<{ body?: unknown; etag?: string } | undefined> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        headers: etag ? { "If-None-Match": etag } : {},
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (response.status === 304) return { etag };
      if (!response.ok) return undefined;
      return { body: await response.json(), etag: response.headers.get("etag") ?? undefined };
    } catch {
      return undefined;
    }
  }

  private setCache(cache: CacheFile | undefined): void {
    this.cache = cache;
    this.normalized = Object.keys(cache?.models ?? {}).map((id) => ({
      id,
      key: normalizeModelName(splitModelId(id).name),
    }));
  }

  private async writeCache(cache: CacheFile): Promise<void> {
    if (this.cachePath) {
      const tmpPath = `${this.cachePath}.tmp`;
      await mkdir(dirname(this.cachePath), { recursive: true });
      try {
        await writeFile(tmpPath, JSON.stringify(cache));
        await rename(tmpPath, this.cachePath);
      } catch (e) {
        await rm(tmpPath, { force: true }).catch(() => {});
        throw e;
      }
    }
    this.setCache(cache);
  }
}

function toCatalogModel(entry: ModelsDevEntry): CatalogModel | undefined {
  if (entry.limit?.context === undefined) return undefined;
  return {
    name: entry.name,
    limit: { context: entry.limit.context, output: entry.limit.output, input: entry.limit.input },
    reasoning: entry.reasoning,
    toolCall: entry.tool_call,
    structuredOutput: entry.structured_output,
    attachment: entry.attachment,
    modalities: { input: entry.modalities.input, output: entry.modalities.output },
    knowledge: entry.knowledge,
  };
}

function toHostEntry(
  host: string,
  id: string,
  entry: ModelsDevEntry,
  models: Record<string, CatalogModel>,
): HostEntry {
  const canonical = entry.canonical_model_id ?? `${host}/${id}`;
  const cost = entry.cost
    ? {
        input: entry.cost.input,
        output: entry.cost.output,
        cacheRead: entry.cost.cache_read,
        cacheWrite: entry.cost.cache_write,
        reasoning: entry.cost.reasoning,
      }
    : undefined;
  const limit = entry.limit
    ? { context: entry.limit.context, output: entry.limit.output, input: entry.limit.input }
    : undefined;
  if (canonical in models) return { canonical, limit, cost };
  return { model: toCatalogModel(entry), limit, cost };
}

function findKey<T>(record: Record<string, T>, id: string): string | undefined {
  if (id in record) return id;
  const lower = id.toLowerCase();
  return Object.keys(record).find((key) => key.toLowerCase() === lower);
}

const BUILD_TAG = /^(mlx|latest|gguf|q\d+(_\w+)?|fp\d+|bf16)$/i;

function normalizeModelName(name: string): string {
  const tokens = name.split(/[-:]/);
  while (tokens.length > 1 && BUILD_TAG.test(tokens[tokens.length - 1])) tokens.pop();
  return tokens
    .join("")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
