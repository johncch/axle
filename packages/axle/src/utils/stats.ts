import type { Stats, TokenStats } from "../types.js";

export function createStats(): Stats {
  return { in: 0, out: 0, breakdown: [] };
}

export function addStats(total: Stats, usage?: Stats): void {
  if (!usage) return;
  addTokens(total, usage);
  total.breakdown = [...total.breakdown, ...usage.breakdown.map((entry) => ({ ...entry }))];
}

export function mergeStats(...usages: Array<Stats | undefined>): Stats {
  const total = createStats();
  for (const usage of usages) addStats(total, usage);
  return total;
}

export function sumTokens(...usages: TokenStats[]): TokenStats {
  const total: TokenStats = { in: 0, out: 0 };
  for (const usage of usages) addTokens(total, usage);
  return total;
}

function addTokens(total: TokenStats, usage: TokenStats): void {
  total.in += usage.in;
  total.out += usage.out;
  addOptionalStat(total, "cachedIn", usage.cachedIn);
  addOptionalStat(total, "cacheWriteIn", usage.cacheWriteIn);
  addOptionalStat(total, "reasoningOut", usage.reasoningOut);
}

/**
 * Attribute a raw token count to the model that produced it, as a `Stats`
 * with its `breakdown` row: one row, or one per entry in `requests` when the
 * count spans several requests. A tool that calls a model API directly uses
 * it to build what `ctx.reportUsage` takes. `provider` is the models.dev
 * provider id; without it the row cannot be priced.
 */
export function attributeStats(
  usage: TokenStats,
  source: {
    provider?: string;
    model: string;
    requestedModel: string;
    agent?: string;
    requests?: TokenStats[];
  },
): Stats {
  const provider = source.provider !== undefined ? { provider: source.provider } : {};
  const agent = source.agent !== undefined ? { agent: source.agent } : {};
  const requests = source.requests?.length ? source.requests : [usage];
  const at = new Date().toISOString();
  return {
    ...usage,
    breakdown: requests.map((request) => ({
      ...provider,
      model: source.model,
      requestedModel: source.requestedModel,
      ...agent,
      at,
      in: request.in,
      out: request.out,
      ...(request.cachedIn !== undefined ? { cachedIn: request.cachedIn } : {}),
      ...(request.cacheWriteIn !== undefined ? { cacheWriteIn: request.cacheWriteIn } : {}),
      ...(request.reasoningOut !== undefined ? { reasoningOut: request.reasoningOut } : {}),
    })),
  };
}

export function withUsageDetails(
  usage: TokenStats,
  details: Pick<TokenStats, "cachedIn" | "cacheWriteIn" | "reasoningOut">,
): TokenStats {
  return {
    ...usage,
    ...positiveDetail("cachedIn", details.cachedIn),
    ...positiveDetail("cacheWriteIn", details.cacheWriteIn),
    ...positiveDetail("reasoningOut", details.reasoningOut),
  };
}

export function toTokenUsage(usage?: TokenStats) {
  if (!usage) return undefined;
  return {
    inputTokens: usage.in,
    outputTokens: usage.out,
    ...(usage.cachedIn !== undefined ? { cachedInputTokens: usage.cachedIn } : {}),
    ...(usage.cacheWriteIn !== undefined ? { cacheWriteInputTokens: usage.cacheWriteIn } : {}),
    ...(usage.reasoningOut !== undefined ? { reasoningOutputTokens: usage.reasoningOut } : {}),
  };
}

function addOptionalStat(
  total: TokenStats,
  key: keyof Pick<TokenStats, "cachedIn" | "cacheWriteIn" | "reasoningOut">,
  value: number | undefined,
): void {
  if (value === undefined) return;
  total[key] = (total[key] ?? 0) + value;
}

function positiveDetail(
  key: keyof Pick<TokenStats, "cachedIn" | "cacheWriteIn" | "reasoningOut">,
  value: number | null | undefined,
): Partial<TokenStats> {
  if (typeof value !== "number") return {};
  return { [key]: value };
}
