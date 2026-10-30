import type { ModelCatalog, ModelCost } from "../models/catalog.js";
import type { Stats, UsageEntry } from "../types.js";
import { addStats, createStats, mergeStats } from "../utils/stats.js";
import type { TurnEvent } from "./events.js";

/** A usage row and what the catalog priced it at, in US dollars. */
export interface PricedEntry extends UsageEntry {
  usd: number;
}

/**
 * Cost accumulated from usage rows. `usd` sums `priced`; `unpriced` holds the
 * rows the catalog had no provider price for, so a host can tell a partial
 * total from a complete one.
 */
export interface Cost {
  usd: number;
  priced: PricedEntry[];
  unpriced: UsageEntry[];
}

/** What a host persists to restore a `Meter`. */
export interface SavedMeter {
  usage: Stats;
  cost: Cost;
}

/**
 * A sink over the turn event stream that accumulates usage and cost from
 * `turn:end`. `usage` and `cost` hold everything the meter was restored with
 * plus what it has applied; `observedUsage` and `observedCost` hold only what
 * this instance applied. Each request row is priced at `apply` time from the
 * catalog's price for its provider and model, at the tier its own prompt size
 * selects; a row with no provider price lands in `cost.unpriced`.
 */
export class Meter {
  private readonly catalog: ModelCatalog | undefined;
  private readonly _usage: Stats;
  private readonly _cost: Cost;
  private readonly _observedUsage: Stats = createStats();
  private readonly _observedCost: Cost = createCost();

  constructor(catalog?: ModelCatalog, saved?: SavedMeter) {
    this.catalog = catalog;
    this._usage = saved ? mergeStats(saved.usage) : createStats();
    this._cost = saved ? copyCost(saved.cost) : createCost();
  }

  static restore(saved: SavedMeter, catalog?: ModelCatalog): Meter {
    return new Meter(catalog, saved);
  }

  get usage(): Stats {
    return this._usage;
  }

  get observedUsage(): Stats {
    return this._observedUsage;
  }

  get cost(): Cost {
    return this._cost;
  }

  get observedCost(): Cost {
    return this._observedCost;
  }

  apply = (event: TurnEvent): void => {
    if (event.type !== "turn:end") return;
    addStats(this._usage, event.usage);
    addStats(this._observedUsage, event.usage);
    for (const entry of event.usage.breakdown ?? []) {
      const usd = this.catalog ? priceEntry(entry, this.catalog) : undefined;
      if (usd === undefined) {
        this._cost.unpriced.push({ ...entry });
        this._observedCost.unpriced.push({ ...entry });
      } else {
        this._cost.usd += usd;
        this._cost.priced.push({ ...entry, usd });
        this._observedCost.usd += usd;
        this._observedCost.priced.push({ ...entry, usd });
      }
    }
  };
}

function createCost(): Cost {
  return { usd: 0, priced: [], unpriced: [] };
}

function copyCost(cost: Cost): Cost {
  return {
    usd: cost.usd,
    priced: cost.priced.map((entry) => ({ ...entry })),
    unpriced: cost.unpriced.map((entry) => ({ ...entry })),
  };
}

type Price = Pick<ModelCost, "input" | "output" | "cacheRead" | "cacheWrite" | "reasoning">;

function priceEntry(entry: UsageEntry, catalog: ModelCatalog): number | undefined {
  if (entry.provider === undefined) return undefined;
  const cost = providerPrice(entry, catalog);
  if (!cost) return undefined;
  const price = tierFor(cost, entry.in);

  const cached = entry.cachedIn ?? 0;
  const written = entry.cacheWriteIn ?? 0;
  const reasoning = entry.reasoningOut ?? 0;
  const plainIn = Math.max(0, entry.in - cached - written);
  const plainOut = Math.max(0, entry.out - reasoning);

  const perMillion =
    plainIn * price.input +
    cached * (price.cacheRead ?? price.input) +
    written * (price.cacheWrite ?? price.input) +
    plainOut * price.output +
    reasoning * (price.reasoning ?? price.output);
  return perMillion / 1_000_000;
}

function providerPrice(entry: UsageEntry, catalog: ModelCatalog): ModelCost | undefined {
  for (const model of [entry.model, entry.requestedModel]) {
    const found = catalog.lookup(model, { provider: entry.provider });
    if (found?.match === "provider" && found.cost) return found.cost;
  }
  return undefined;
}

function tierFor(cost: ModelCost, context: number): Price {
  let price: Price = cost;
  for (const tier of cost.tiers ?? []) {
    if (context > tier.size) price = tier;
  }
  return {
    input: price.input,
    output: price.output,
    ...(price.cacheRead !== undefined ? { cacheRead: price.cacheRead } : {}),
    ...(price.cacheWrite !== undefined ? { cacheWrite: price.cacheWrite } : {}),
    ...(price.reasoning !== undefined ? { reasoning: price.reasoning } : {}),
  };
}
