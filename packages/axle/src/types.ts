export type PlainObject = Record<string, unknown>;

/**
 * Token usage reported by a provider response.
 */
export interface Stats {
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
