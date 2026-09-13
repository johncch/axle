const INTERVAL_GRAMMAR = /^([1-9][0-9]*)([smhd])$/;

export const INTERVAL_PATTERN = INTERVAL_GRAMMAR.source;
export const MIN_INTERVAL_SECONDS = 60;
export const MAX_INTERVAL_SECONDS = 2 ** 31 - 1;

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };

/**
 * Parse a recipe `schedule.every` value into whole seconds. The grammar is
 * exactly `<positive integer><unit>` with units `s`, `m`, `h`, `d`; a day is
 * 24 hours. Rejects anything under 60 seconds or above what a backend can
 * hold in a signed 32-bit interval.
 */
export function parseInterval(every: string): number {
  const match = INTERVAL_GRAMMAR.exec(every);
  if (!match) {
    throw new Error(
      `Invalid interval "${every}": expected <positive integer><unit> with unit s, m, h, or d (for example 15m or 1h).`,
    );
  }
  const seconds = Number(match[1]) * UNIT_SECONDS[match[2]];
  if (seconds < MIN_INTERVAL_SECONDS) {
    throw new Error(`Invalid interval "${every}": the minimum is ${MIN_INTERVAL_SECONDS}s.`);
  }
  if (!Number.isSafeInteger(seconds) || seconds > MAX_INTERVAL_SECONDS) {
    throw new Error(`Invalid interval "${every}": the maximum is ${MAX_INTERVAL_SECONDS} seconds.`);
  }
  return seconds;
}

export function formatInterval(seconds: number): string {
  for (const unit of ["d", "h", "m"] as const) {
    if (seconds % UNIT_SECONDS[unit] === 0) return `${seconds / UNIT_SECONDS[unit]}${unit}`;
  }
  return `${seconds}s`;
}
