import { z } from "zod";
import { splitModelId } from "../protocols/model.js";

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

const PriceSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional(),
  reasoning: z.number().optional(),
});

const ModelCostSchema = PriceSchema.extend({
  /** Prices for a request whose context exceeds `size` tokens, ascending by size. */
  tiers: z.array(PriceSchema.extend({ size: z.number().int().nonnegative() })).optional(),
});

const ProviderEntrySchema = z.object({
  canonical: z.string().optional(),
  model: CatalogModelSchema.optional(),
  limit: CatalogModelSchema.shape.limit.partial().optional(),
  cost: ModelCostSchema.optional(),
});

const CatalogDataSchema = z.object({
  version: z.literal(4),
  fetchedAt: z.string(),
  etags: z.object({ models: z.string().optional(), api: z.string().optional() }),
  coverage: z.union([z.literal("all"), z.array(z.string())]),
  models: z.record(z.string(), CatalogModelSchema),
  providers: z.record(z.string(), z.record(z.string(), ProviderEntrySchema)),
});

/**
 * The data a `ModelCatalog` indexes, as plain JSON: a canonical layer
 * (`models`, keyed `publisher/model`) and a per-provider layer (`providers`,
 * each provider's own ids with its limits and prices). `fetchedAt` is ISO
 * 8601; `etags` let `fetchModelsDev` skip unchanged layers; `coverage` is the
 * provider filter the data was fetched with (`"all"`, or the provider ids
 * kept). Save it, load it, or write your own; a change to the shape bumps
 * `version`.
 */
export type CatalogData = z.infer<typeof CatalogDataSchema>;

/**
 * Read saved `CatalogData` from its JSON text. `undefined` when the text is
 * not JSON, or is data of another `version` or shape: either way there is
 * no usable copy, and the answer is to fetch.
 */
export function parseCatalogData(json: string): CatalogData | undefined {
  let value: CatalogData;
  try {
    value = JSON.parse(json);
  } catch {
    return undefined;
  }
  const parsed = CatalogDataSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export type ProviderEntry = z.infer<typeof ProviderEntrySchema>;

/** What the catalog records about a model, independent of who serves it. */
export type CatalogModel = z.infer<typeof CatalogModelSchema>;

/** Price per million tokens, as the provider charges it. */
export type ModelCost = z.infer<typeof ModelCostSchema>;

export interface CatalogMatch {
  /** The canonical `publisher/model` id, or `provider/id` for a model only that provider lists. */
  id: string;
  /** `provider`: the provider's own id matched exactly; `exact`/`prefix`: matched by canonical id or name. */
  match: "provider" | "exact" | "prefix";
  model: CatalogModel;
  /** Present only for a provider match. */
  cost?: ModelCost;
}

export interface ContextWindowMatch {
  window: number;
  id: string;
  match: CatalogMatch["match"];
}

/**
 * Model metadata looked up from `CatalogData`. Synchronous and immutable: it
 * never fetches; to refresh, build a new catalog from new data
 * (`fetchModelsDev`). The data is taken as given; read saved data with
 * `parseCatalogData`.
 *
 * @experimental The catalog API is new in 0.35 and may change in a minor release.
 *
 * `lookup()` tries the provider's own id first when a provider is given, then the
 * canonical key, then a best-effort match for local runtimes' names
 * (`gemma4:26b-mlx`): trailing build tags dropped, punctuation and case
 * ignored, publisher ignored, exact normalized match first, else a unique
 * prefix.
 */
export class ModelCatalog {
  private readonly data: CatalogData;
  private readonly normalized: { id: string; key: string }[];

  constructor(data: CatalogData) {
    this.data = data;
    this.normalized = Object.keys(data.models).map((id) => ({
      id,
      key: normalizeModelName(splitModelId(id).name),
    }));
  }

  /** When the data was fetched, ISO 8601. */
  get fetchedAt(): string {
    return this.data.fetchedAt;
  }

  /** The provider filter the data was fetched with: `"all"`, or the provider ids kept. */
  get coverage(): CatalogData["coverage"] {
    return this.data.coverage;
  }

  lookup(
    model: string,
    options?: { provider?: string; publisher?: string },
  ): CatalogMatch | undefined {
    const { publisher, name } = splitModelId(model);

    if (options?.provider) {
      const entries = this.data.providers[options.provider];
      const publisherIsProvider = publisher === options.provider.toLowerCase();
      const providerModelId = entries
        ? (findKey(entries, model) ?? (publisherIsProvider ? findKey(entries, name) : undefined))
        : undefined;
      if (entries && providerModelId !== undefined) {
        const entry = entries[providerModelId];
        const base = entry.canonical ? this.data.models[entry.canonical] : entry.model;
        if (base) {
          return {
            id: entry.canonical ?? `${options.provider}/${providerModelId}`,
            match: "provider",
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
      const id = findKey(this.data.models, qualified);
      if (id !== undefined) return { id, match: "exact", model: this.data.models[id] };
    }

    const key = normalizeModelName(name);
    if (key.length === 0) return undefined;
    const exact = this.normalized.filter((entry) => entry.key === key);
    if (exact.length === 1) {
      return { id: exact[0].id, match: "exact", model: this.data.models[exact[0].id] };
    }
    if (exact.length > 1) return undefined;
    const prefixed = this.normalized.filter((entry) => entry.key.startsWith(key));
    if (prefixed.length === 1) {
      return { id: prefixed[0].id, match: "prefix", model: this.data.models[prefixed[0].id] };
    }
    return undefined;
  }

  contextWindow(
    model: string,
    options?: { provider?: string; publisher?: string },
  ): ContextWindowMatch | undefined {
    const found = this.lookup(model, options);
    return found
      ? { window: found.model.limit.context, id: found.id, match: found.match }
      : undefined;
  }
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
