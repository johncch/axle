import type { Stats, UsageEntry } from "../types.js";

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
    total.breakdown = mergeBreakdown(total.breakdown, usage.breakdown);
  }
}

export function mergeStats(...usages: Array<Stats | undefined>): Stats {
  const total = createStats();
  for (const usage of usages) addStats(total, usage);
  return total;
}

/**
 * Attribute provider-reported usage to its provider+model pair so it survives
 * aggregation across turns and subagents.
 */
export function attributeStats(usage: Stats, source: { provider: string; model: string }): Stats {
  return {
    ...usage,
    breakdown: [
      {
        provider: source.provider,
        model: source.model,
        in: usage.in,
        out: usage.out,
        ...(usage.cachedIn !== undefined ? { cachedIn: usage.cachedIn } : {}),
        ...(usage.cacheWriteIn !== undefined ? { cacheWriteIn: usage.cacheWriteIn } : {}),
        ...(usage.reasoningOut !== undefined ? { reasoningOut: usage.reasoningOut } : {}),
      },
    ],
  };
}

function mergeBreakdown(into: UsageEntry[] | undefined, entries: UsageEntry[]): UsageEntry[] {
  const merged = into ? [...into] : [];
  for (const entry of entries) {
    const existing = merged.find(
      (candidate) => candidate.provider === entry.provider && candidate.model === entry.model,
    );
    if (!existing) {
      merged.push({ ...entry });
      continue;
    }
    existing.in += entry.in;
    existing.out += entry.out;
    addOptionalStat(existing, "cachedIn", entry.cachedIn);
    addOptionalStat(existing, "cacheWriteIn", entry.cacheWriteIn);
    addOptionalStat(existing, "reasoningOut", entry.reasoningOut);
  }
  return merged;
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
