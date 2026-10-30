import type { ModelCatalog, ModelCost } from "../models/catalog.js";
import type { Stats, UsageEntry } from "../types.js";
import { addStats, createStats, mergeStats } from "../utils/stats.js";
import type { TurnEvent } from "./events.js";

/** A usage row and what the catalog priced it at, in US dollars. */
export interface PricedEntry extends UsageEntry {
  usd: number;
}

/**
 * Why a row has no price. `loading` and `unavailable` are the catalog's state and may
 * resolve on a later read; the rest are facts about the row and will not.
 */
export type UnpricedReason =
  "loading" | "unavailable" | "no-catalog" | "no-provider" | "unlisted" | "no-price";

export interface UnpricedEntry extends UsageEntry {
  reason: UnpricedReason;
}

/**
 * Cost derived from usage rows at the moment it is read. `usd` sums `priced`;
 * `unpriced` holds every row the catalog could not price, each with its reason.
 */
export interface Cost {
  usd: number;
  priced: PricedEntry[];
  unpriced: UnpricedEntry[];
}

/**
 * A sink over the turn event stream that accumulates usage from `turn:end` and
 * prices it against a `ModelCatalog`. `usage` holds what the meter was restored
 * with plus what it has applied; `observedUsage` only what this instance applied.
 * `cost` and `observedCost` are computed from those rows and the catalog's
 * current state each time they are read, so a row the catalog could not price
 * yet is priced on the first read after the catalog arrives. `priced()` resolves
 * to `cost` once the catalog's `ready` has settled; it never rejects. Pass the
 * saved `usage` to the constructor to restore a meter.
 */
export class Meter {
  private readonly catalog: ModelCatalog | undefined;
  private readonly _usage: Stats;
  private readonly _observedUsage: Stats = createStats();

  constructor(catalog?: ModelCatalog, saved?: Stats) {
    this.catalog = catalog;
    this._usage = saved ? mergeStats(saved) : createStats();
  }

  get usage(): Stats {
    return this._usage;
  }

  get observedUsage(): Stats {
    return this._observedUsage;
  }

  get cost(): Cost {
    return priceRows(this._usage.breakdown ?? [], this.catalog);
  }

  get observedCost(): Cost {
    return priceRows(this._observedUsage.breakdown ?? [], this.catalog);
  }

  async priced(): Promise<Cost> {
    await this.catalog?.ready;
    return this.cost;
  }

  apply = (event: TurnEvent): void => {
    if (event.type !== "turn:end") return;
    addStats(this._usage, event.usage);
    addStats(this._observedUsage, event.usage);
  };
}

function priceRows(rows: readonly UsageEntry[], catalog: ModelCatalog | undefined): Cost {
  const cost: Cost = { usd: 0, priced: [], unpriced: [] };
  for (const row of rows) {
    const outcome = priceRow(row, catalog);
    if (typeof outcome === "number") {
      cost.usd += outcome;
      cost.priced.push({ ...row, usd: outcome });
    } else {
      cost.unpriced.push({ ...row, reason: outcome });
    }
  }
  return cost;
}

function priceRow(row: UsageEntry, catalog: ModelCatalog | undefined): number | UnpricedReason {
  if (!catalog) return "no-catalog";
  if (row.provider === undefined) return "no-provider";
  const status = catalog.state.status;
  if (status !== "loaded") return status;

  let reason: UnpricedReason = "unlisted";
  for (const model of [row.model, row.requestedModel]) {
    const found = catalog.lookup(model, { provider: row.provider });
    if (found?.match !== "provider") continue;
    if (found.cost) return priceAt(found.cost, row);
    reason = "no-price";
  }
  return reason;
}

type Price = Pick<ModelCost, "input" | "output" | "cacheRead" | "cacheWrite" | "reasoning">;

function priceAt(cost: ModelCost, row: UsageEntry): number {
  const price = tierFor(cost, row.in);
  const cached = row.cachedIn ?? 0;
  const written = row.cacheWriteIn ?? 0;
  const reasoning = row.reasoningOut ?? 0;
  const plainIn = Math.max(0, row.in - cached - written);
  const plainOut = Math.max(0, row.out - reasoning);

  const perMillion =
    plainIn * price.input +
    cached * (price.cacheRead ?? price.input) +
    written * (price.cacheWrite ?? price.input) +
    plainOut * price.output +
    reasoning * (price.reasoning ?? price.output);
  return perMillion / 1_000_000;
}

function tierFor(cost: ModelCost, context: number): Price {
  let price: Price = cost;
  for (const tier of cost.tiers ?? []) {
    if (context > tier.size) price = tier;
  }
  return price;
}
