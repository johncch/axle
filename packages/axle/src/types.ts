export type PlainObject = Record<string, unknown>;

export interface TokenStats {
  /** Total effective input tokens. Includes `cachedIn` and `cacheWriteIn` when reported. */
  in: number;

  /** Total output tokens. Includes `reasoningOut` when reported. */
  out: number;

  /** Input tokens served from provider prompt/context cache. Included in `in`. */
  cachedIn?: number;

  /** Input tokens written into provider prompt/context cache. Included in `in`. */
  cacheWriteIn?: number;

  /** Output tokens spent on reasoning/thinking. Included in `out`. */
  reasoningOut?: number;
}

export interface UsageEntry extends TokenStats {
  /** Provider identifier. */
  provider: string;
  /** Model identifier. */
  model: string;
}

/**
 * Aggregate usage reported by an Axle operation.
 *
 * `breakdown` holds one entry per provider+model pair so cost can be
 * reconstructed when an operation spans models (for example subagent tools).
 * Entries explain the aggregate numeric fields and must not be added to them
 * again.
 */
export interface Stats extends TokenStats {
  breakdown?: UsageEntry[];
}
