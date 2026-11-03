import { z } from "zod";
import type { CatalogData, CatalogModel, ModelCost, ProviderEntry } from "./catalog.js";

const MODELS_DEV_URL = "https://models.dev";
const DEFAULT_TIMEOUT_MS = 10_000;

const ModelsDevPriceSchema = z.looseObject({
  input: z.number(),
  output: z.number(),
  cache_read: z.number().optional(),
  cache_write: z.number().optional(),
  reasoning: z.number().optional(),
});

// models.dev writes 0 for an unknown limit; `.catch(null)` drops a malformed
// entry instead of failing the whole file.
const ModelsDevEntrySchema = z.looseObject({
  name: z.string(),
  limit: z
    .looseObject({
      context: z.number().int().nonnegative().optional(),
      output: z.number().int().nonnegative().optional(),
      input: z.number().int().nonnegative().optional(),
    })
    .optional(),
  reasoning: z.boolean(),
  tool_call: z.boolean(),
  structured_output: z.boolean().optional(),
  attachment: z.boolean(),
  modalities: z.looseObject({ input: z.array(z.string()), output: z.array(z.string()) }),
  knowledge: z.string().optional(),
  cost: ModelsDevPriceSchema.extend({
    tiers: z
      .array(
        ModelsDevPriceSchema.extend({
          tier: z.looseObject({ size: z.number().int().nonnegative() }),
        }),
      )
      .optional(),
  }).optional(),
  canonical_model_id: z.string().optional(),
});

type ModelsDevEntry = z.infer<typeof ModelsDevEntrySchema>;

const LenientEntrySchema = ModelsDevEntrySchema.nullable().catch(null);
const ModelsDevModelsSchema = z.record(z.string(), LenientEntrySchema);
const ModelsDevApiSchema = z.record(
  z.string(),
  z.looseObject({ models: z.record(z.string(), LenientEntrySchema) }),
);

export interface FetchModelsDevOptions {
  /**
   * models.dev provider ids whose own model ids to keep (`anthropic`, `openrouter`,
   * `togetherai`, …). Omit for every provider; `[]` skips the per-provider layer.
   */
  providers?: string[];
  /** The last data fetched; its ETags make each request conditional, so an unchanged layer downloads nothing. */
  previous?: CatalogData;
  /** Milliseconds the whole fetch may take. Defaults to ten seconds. */
  timeout?: number;
  /** Catalog origin; defaults to models.dev. */
  baseUrl?: string;
  signal?: AbortSignal;
}

/**
 * `fetchModelsDev` could not fetch or read models.dev: a network failure, the
 * timeout, an HTTP error status, or a body of the wrong shape. `cause` holds
 * the underlying error where there is one.
 */
export class CatalogFetchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(`Model catalog fetch failed: ${message}`, options);
    this.name = "CatalogFetchError";
  }
}

type Layer = { unchanged: true } | { unchanged: false; body: unknown; etag?: string };

/**
 * Fetch the models.dev catalog as `CatalogData` for `new ModelCatalog(data)`.
 * Slims it to what the catalog reads and keeps only the `providers` asked for.
 * With `previous`, a layer models.dev reports unchanged is taken from
 * `previous`; `fetchedAt` is always the time of this fetch. Rejects with a
 * `CatalogFetchError` when either layer cannot be fetched or parsed; there is
 * no partial result.
 */
export async function fetchModelsDev(options: FetchModelsDevOptions = {}): Promise<CatalogData> {
  const coverage: CatalogData["coverage"] = options.providers ?? "all";
  const wantProviders = coverage === "all" || coverage.length > 0;
  const previous = options.previous;
  const previousProviders =
    previous && sameCoverage(previous.coverage, coverage) ? previous : undefined;
  const baseUrl = options.baseUrl ?? MODELS_DEV_URL;
  const timeout = AbortSignal.timeout(options.timeout ?? DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  const [modelsLayer, apiLayer] = await Promise.all([
    fetchLayer(`${baseUrl}/models.json`, previous?.etags.models, signal),
    wantProviders
      ? fetchLayer(`${baseUrl}/api.json`, previousProviders?.etags.api, signal)
      : undefined,
  ]);

  const models = modelsLayer.unchanged && previous ? previous.models : parseModels(modelsLayer);
  const providers =
    apiLayer === undefined
      ? {}
      : apiLayer.unchanged && previousProviders
        ? previousProviders.providers
        : parseProviders(apiLayer, coverage, models);

  return {
    version: 4,
    fetchedAt: new Date().toISOString(),
    etags: {
      models: modelsLayer.unchanged ? previous?.etags.models : modelsLayer.etag,
      api:
        apiLayer === undefined
          ? undefined
          : apiLayer.unchanged
            ? previousProviders?.etags.api
            : apiLayer.etag,
    },
    coverage,
    models,
    providers,
  };
}

function sameCoverage(a: CatalogData["coverage"], b: CatalogData["coverage"]): boolean {
  if (a === "all" || b === "all") return a === b;
  return a.length === b.length && a.every((provider) => b.includes(provider));
}

async function fetchLayer(
  url: string,
  etag: string | undefined,
  signal: AbortSignal,
): Promise<Layer> {
  let response: Response;
  try {
    response = await fetch(url, { headers: etag ? { "If-None-Match": etag } : {}, signal });
  } catch (cause) {
    throw new CatalogFetchError(`Could not reach ${url}`, { cause });
  }
  if (response.status === 304) return { unchanged: true };
  if (!response.ok) throw new CatalogFetchError(`${url} answered ${response.status}`);
  try {
    return {
      unchanged: false,
      body: await response.json(),
      etag: response.headers.get("etag") ?? undefined,
    };
  } catch (cause) {
    throw new CatalogFetchError(`${url} did not return JSON`, { cause });
  }
}

function parseModels(layer: Layer): Record<string, CatalogModel> {
  if (layer.unchanged)
    throw new CatalogFetchError("models.json answered 304 to a request without an ETag");
  const parsed = ModelsDevModelsSchema.safeParse(layer.body);
  if (!parsed.success)
    throw new CatalogFetchError("models.json does not match the expected shape", {
      cause: parsed.error,
    });
  const models: Record<string, CatalogModel> = {};
  for (const [id, entry] of Object.entries(parsed.data)) {
    const model = entry ? toCatalogModel(entry) : undefined;
    if (model) models[id] = model;
  }
  return models;
}

function parseProviders(
  layer: Layer,
  coverage: CatalogData["coverage"],
  models: Record<string, CatalogModel>,
): CatalogData["providers"] {
  if (layer.unchanged)
    throw new CatalogFetchError("api.json answered 304 to a request without an ETag");
  const parsed = ModelsDevApiSchema.safeParse(layer.body);
  if (!parsed.success)
    throw new CatalogFetchError("api.json does not match the expected shape", {
      cause: parsed.error,
    });
  const providers: CatalogData["providers"] = {};
  for (const [provider, listing] of Object.entries(parsed.data)) {
    if (coverage !== "all" && !coverage.includes(provider)) continue;
    providers[provider] = {};
    for (const [id, entry] of Object.entries(listing.models)) {
      if (entry) providers[provider][id] = toProviderEntry(provider, id, entry, models);
    }
  }
  return providers;
}

function toPrice(price: z.infer<typeof ModelsDevPriceSchema>): Omit<ModelCost, "tiers"> {
  return {
    input: price.input,
    output: price.output,
    cacheRead: price.cache_read,
    cacheWrite: price.cache_write,
    reasoning: price.reasoning,
  };
}

function knownLimit(value: number | undefined): number | undefined {
  return value === undefined || value === 0 ? undefined : value;
}

function toCatalogModel(entry: ModelsDevEntry): CatalogModel | undefined {
  const context = knownLimit(entry.limit?.context);
  if (context === undefined) return undefined;
  return {
    name: entry.name,
    limit: {
      context,
      output: knownLimit(entry.limit?.output),
      input: knownLimit(entry.limit?.input),
    },
    reasoning: entry.reasoning,
    toolCall: entry.tool_call,
    structuredOutput: entry.structured_output,
    attachment: entry.attachment,
    modalities: { input: entry.modalities.input, output: entry.modalities.output },
    knowledge: entry.knowledge,
  };
}

function toProviderEntry(
  provider: string,
  id: string,
  entry: ModelsDevEntry,
  models: Record<string, CatalogModel>,
): ProviderEntry {
  const canonical = entry.canonical_model_id ?? `${provider}/${id}`;
  const cost = entry.cost
    ? {
        ...toPrice(entry.cost),
        tiers: entry.cost.tiers
          ?.map((tier) => ({ ...toPrice(tier), size: tier.tier.size }))
          .sort((a, b) => a.size - b.size),
      }
    : undefined;
  const limit = entry.limit
    ? {
        context: knownLimit(entry.limit.context),
        output: knownLimit(entry.limit.output),
        input: knownLimit(entry.limit.input),
      }
    : undefined;
  if (canonical in models) return { canonical, limit, cost };
  return { model: toCatalogModel(entry), limit, cost };
}
