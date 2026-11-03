import type { Stats, UsageEntry } from "../types.js";
import type { ModelCatalog, ModelCost } from "./catalog.js";

/** A usage row and what the catalog priced it at, in US dollars. */
export interface PricedEntry extends UsageEntry {
  usd: number;
}

/** Why a row has no price. */
export type UnpricedReason = "no-catalog" | "no-provider" | "unlisted" | "no-price";

export interface UnpricedEntry extends UsageEntry {
  reason: UnpricedReason;
}

/**
 * What a `Stats` cost. `usd` sums `priced`; `unpriced` holds every row the
 * catalog could not price, each with its reason.
 */
export interface Cost {
  usd: number;
  priced: PricedEntry[];
  unpriced: UnpricedEntry[];
  /** `fetchedAt` of the catalog that priced the rows, ISO 8601; absent when none was priced. */
  pricedWith?: string;
}

/**
 * Price every `breakdown` row of `usage` against `catalog`. Never throws: a
 * row it cannot price is in `unpriced` with its reason. Each row is priced at
 * the tier its own `in` selects.
 *
 * @experimental The cost and catalog API is new in 0.35 and may change in a minor release.
 */
export function computeCost(usage: Stats, catalog?: ModelCatalog): Cost {
  return priceRows(usage.breakdown, catalog);
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
  if (catalog && cost.priced.length > 0) cost.pricedWith = catalog.fetchedAt;
  return cost;
}

function priceRow(row: UsageEntry, catalog: ModelCatalog | undefined): number | UnpricedReason {
  if (!catalog) return "no-catalog";
  if (row.provider === undefined) return "no-provider";

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
