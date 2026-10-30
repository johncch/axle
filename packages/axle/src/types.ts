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
  /** models.dev id of the provider that served the request (`AIProvider.id`); absent when unknown. */
  provider?: string;
  /** Model the response reported serving the request; the requested model when it reported none. */
  model: string;
  /** Model string the caller asked for, as passed to `Agent` or `stream()`. */
  requestedModel: string;
  /** Name of the `Agent` that made the request, when it has one. */
  agent?: string;
  /** When the provider finished the request, ISO 8601. */
  at: string;
}

/**
 * Aggregate usage reported by an Axle operation.
 *
 * `breakdown` holds one entry per provider request, in request order, so
 * cost can be computed at the tier each request's prompt size selected. A
 * subagent's rows sit between the parent requests that bracket its tool
 * call, each tagged with the agent that made it. Entries explain the
 * aggregate numeric fields and must not be added to them again; a reader
 * that wants per-model or per-agent totals groups them.
 */
export interface Stats extends TokenStats {
  /** @experimental One row per request; the row shape may gain dimensions in a minor release. */
  breakdown?: UsageEntry[];
}
