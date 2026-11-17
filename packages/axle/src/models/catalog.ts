import { z } from "zod";
import { splitModelId } from "../protocols/model.js";
import {
  REASONING_LEVELS,
  type ReasoningEffort,
  type ReasoningLevel,
} from "../protocols/reasoning.js";

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

const ReasoningOptionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("effort"), values: z.array(z.string()) }),
  z.object({
    type: z.literal("budget"),
    min: z.number().int().nonnegative().optional(),
    max: z.number().int().nonnegative().optional(),
  }),
  z.object({ type: z.literal("toggle") }),
]);

const ProviderEntrySchema = z.object({
  canonical: z.string().optional(),
  model: CatalogModelSchema.optional(),
  limit: CatalogModelSchema.shape.limit.partial().optional(),
  cost: ModelCostSchema.optional(),
  reasoningOptions: z.array(ReasoningOptionSchema).optional(),
});

const CatalogDataSchema = z.object({
  version: z.literal(5),
  fetchedAt: z.string(),
  etags: z.object({ models: z.string().optional(), api: z.string().optional() }),
  coverage: z.union([z.literal("all"), z.array(z.string())]),
  models: z.record(z.string(), CatalogModelSchema),
  providers: z.record(z.string(), z.record(z.string(), ProviderEntrySchema)),
});

/**
 * The data a `ModelCatalog` indexes, as plain JSON: a canonical layer
 * (`models`, keyed `publisher/model`) and a per-provider layer (`providers`,
 * each provider's own ids with its limits, prices and reasoning controls). `fetchedAt` is ISO
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

/**
 * One way a provider lets a model's thinking be controlled, as models.dev
 * records it: named `effort` levels in the provider's own words (`none`
 * included where it has one), a token `budget` range, or an on/off `toggle`.
 */
export type CatalogReasoningOption = z.infer<typeof ReasoningOptionSchema>;

export interface CatalogMatch {
  /** The canonical `publisher/model` id, or `provider/id` for a model only that provider lists. */
  id: string;
  /** `provider`: the provider's own id matched exactly; `exact`/`prefix`: matched by canonical id or name. */
  match: "provider" | "exact" | "prefix";
  model: CatalogModel;
  /** Present only for a provider match. */
  cost?: ModelCost;
  /** Present only for a provider match, and only where the catalog records it. */
  reasoningOptions?: CatalogReasoningOption[];
}

export interface ContextWindowMatch {
  window: number;
  id: string;
  match: CatalogMatch["match"];
}

export interface ReasoningControlMatch {
  /**
   * How the provider lets the model's thinking be set: named `levels`, an
   * on/off `toggle`, or `none` for a model that does not reason or whose
   * thinking cannot be set.
   */
  control: "levels" | "toggle" | "none";
  /**
   * The `reasoning` efforts to offer, lowest first: the provider's listed
   * levels (every level for a model that only takes a token budget), `on`
   * for a toggle, nothing for `none`. `off` is never listed; the catalog
   * does not record whether a model can be turned off.
   */
  efforts: ReasoningEffort[];
  /**
   * The effort for an on/off control to send: the level closest to medium,
   * the higher one on a tie, or `on` for a toggle. Absent for `none`.
   */
  suggested?: ReasoningEffort;
  id: string;
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
            reasoningOptions: entry.reasoningOptions,
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

  /**
   * How a provider's model has its thinking set: the kind of control, the
   * `reasoning` efforts to offer, and one to send when the choice is only
   * on or off. Advisory: requests are never checked against it. `undefined`
   * when the catalog has no record of the provider's reasoning controls for
   * the model.
   */
  reasoningControl(
    model: string,
    options: { provider: string },
  ): ReasoningControlMatch | undefined {
    const found = this.lookup(model, options);
    if (!found) return undefined;
    if (!found.model.reasoning) return { control: "none", efforts: [], id: found.id };
    if (!found.reasoningOptions) return undefined;
    const levels = listedLevels(found.reasoningOptions);
    if (levels.length > 0) {
      return { control: "levels", efforts: levels, suggested: nearestMedium(levels), id: found.id };
    }
    if (found.reasoningOptions.some((option) => option.type === "toggle")) {
      return { control: "toggle", efforts: ["on"], suggested: "on", id: found.id };
    }
    return { control: "none", efforts: [], id: found.id };
  }
}

function listedLevels(options: CatalogReasoningOption[]): ReasoningLevel[] {
  const named = options.find((option) => option.type === "effort");
  const levels = named ? REASONING_LEVELS.filter((level) => named.values.includes(level)) : [];
  if (levels.length > 0) return levels;
  return options.some((option) => option.type === "budget") ? [...REASONING_LEVELS] : [];
}

function nearestMedium(levels: ReasoningLevel[]): ReasoningLevel | undefined {
  const medium = REASONING_LEVELS.indexOf("medium");
  let suggested: ReasoningLevel | undefined;
  let nearest = Infinity;
  for (const level of levels) {
    const distance = Math.abs(REASONING_LEVELS.indexOf(level) - medium);
    if (distance <= nearest) {
      suggested = level;
      nearest = distance;
    }
  }
  return suggested;
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
