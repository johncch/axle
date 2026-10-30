import type { Stats, TokenStats } from "../types.js";

export function createStats(): Stats {
  return { in: 0, out: 0 };
}

export function addStats(total: Stats, usage?: Stats): void {
  if (!usage) return;
  total.in += usage.in ?? 0;
  total.out += usage.out ?? 0;
  addOptionalStat(total, "cachedIn", usage.cachedIn);
  addOptionalStat(total, "cacheWriteIn", usage.cacheWriteIn);
  addOptionalStat(total, "reasoningOut", usage.reasoningOut);
  if (usage.breakdown?.length) {
    total.breakdown = [
      ...(total.breakdown ?? []),
      ...usage.breakdown.map((entry) => ({ ...entry })),
    ];
  }
}

export function mergeStats(...usages: Array<Stats | undefined>): Stats {
  const total = createStats();
  for (const usage of usages) addStats(total, usage);
  return total;
}

/**
 * Attribute a step's provider-reported usage to breakdown rows that survive
 * aggregation across turns and subagents: one row for the step, or one per
 * request when the step took more than one.
 */
export function attributeStats(
  usage: Stats,
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
  return {
    ...usage,
    breakdown: requests.map((request) => ({
      ...provider,
      model: source.model,
      requestedModel: source.requestedModel,
      ...agent,
      in: request.in,
      out: request.out,
      ...(request.cachedIn !== undefined ? { cachedIn: request.cachedIn } : {}),
      ...(request.cacheWriteIn !== undefined ? { cacheWriteIn: request.cacheWriteIn } : {}),
      ...(request.reasoningOut !== undefined ? { reasoningOut: request.reasoningOut } : {}),
    })),
  };
}

export function withUsageDetails(
  usage: Stats,
  details: Pick<Stats, "cachedIn" | "cacheWriteIn" | "reasoningOut">,
): Stats {
  return {
    ...usage,
    ...positiveDetail("cachedIn", details.cachedIn),
    ...positiveDetail("cacheWriteIn", details.cacheWriteIn),
    ...positiveDetail("reasoningOut", details.reasoningOut),
  };
}

export function toTokenUsage(usage?: Stats) {
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
  total: Stats,
  key: keyof Pick<Stats, "cachedIn" | "cacheWriteIn" | "reasoningOut">,
  value: number | undefined,
): void {
  if (value === undefined) return;
  total[key] = (total[key] ?? 0) + value;
}

function positiveDetail(
  key: keyof Pick<Stats, "cachedIn" | "cacheWriteIn" | "reasoningOut">,
  value: number | null | undefined,
): Partial<Stats> {
  if (typeof value !== "number") return {};
  return { [key]: value };
}
