import type { Stats } from "../types.js";

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
