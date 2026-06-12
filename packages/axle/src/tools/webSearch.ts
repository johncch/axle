import * as z from "zod";
import type { Span } from "../observability/types.js";
import type { ExecutableTool } from "./types.js";

export interface WebSearchRequest {
  query: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippets: string[];
}

export interface WebSearchResponse {
  results: WebSearchResult[];
}

export interface WebSearchBackendContext {
  signal: AbortSignal;
  span?: Span;
}

export interface WebSearchBackend {
  readonly name: string;
  search(request: WebSearchRequest, context: WebSearchBackendContext): Promise<WebSearchResponse>;
}

const webSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(400),
});

export function createWebSearchFallbackTool(
  backend: WebSearchBackend,
): ExecutableTool<typeof webSearchInputSchema> {
  return {
    name: "web_search",
    description:
      "Search the public web for current information. Returns source titles, URLs, and relevant extracted passages.",
    schema: webSearchInputSchema,
    async execute(input, context) {
      context.span?.setAttribute("webSearchBackend", backend.name);
      const response = await backend.search(
        { query: input.query },
        { signal: context.signal, span: context.span },
      );
      context.span?.setAttribute("webSearchResultCount", response.results.length);
      return JSON.stringify({
        query: input.query,
        results: response.results,
      });
    },
    summarize(input) {
      return `Search the web for "${input.query}"`;
    },
  };
}

export interface BraveWebSearchOptions {
  apiKey: string;
  endpoint?: string;
  maxResults?: number;
  candidateCount?: number;
  maxTokens?: number;
  maxSnippets?: number;
  maxTokensPerUrl?: number;
  maxSnippetsPerUrl?: number;
  contextThresholdMode?: string;
  country?: string;
  searchLanguage?: string;
  freshness?: "pd" | "pw" | "pm" | "py" | `${string}to${string}`;
  timeoutMs?: number;
}

interface BraveLlmContextItem {
  title?: string;
  url?: string;
  snippets?: string[];
}

interface BraveLlmContextResponse {
  grounding?: {
    generic?: BraveLlmContextItem[];
    poi?: BraveLlmContextItem;
    map?: BraveLlmContextItem[];
  };
}

export function braveWebSearch(options: BraveWebSearchOptions): WebSearchBackend {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error("Brave Search apiKey is required");

  const endpoint = options.endpoint ?? "https://api.search.brave.com/res/v1/llm/context";
  const maxResults = requireIntegerInRange(options.maxResults ?? 5, "maxResults", 1, 50);
  const candidateCount =
    options.candidateCount === undefined
      ? undefined
      : requireIntegerInRange(options.candidateCount, "candidateCount", 1, 50);
  const maxTokens = requireIntegerInRange(options.maxTokens ?? 4_096, "maxTokens", 1, 32_768);
  const maxSnippets =
    options.maxSnippets === undefined
      ? undefined
      : requireIntegerInRange(options.maxSnippets, "maxSnippets", 1, 256);
  const maxTokensPerUrl =
    options.maxTokensPerUrl === undefined
      ? undefined
      : requireIntegerInRange(options.maxTokensPerUrl, "maxTokensPerUrl", 1, 8_192);
  const maxSnippetsPerUrl =
    options.maxSnippetsPerUrl === undefined
      ? undefined
      : requireIntegerInRange(options.maxSnippetsPerUrl, "maxSnippetsPerUrl", 1, 100);
  const timeoutMs =
    options.timeoutMs === undefined
      ? undefined
      : requireIntegerInRange(options.timeoutMs, "timeoutMs", 1);

  return {
    name: "brave",
    async search(request, context) {
      const url = new URL(endpoint);
      url.searchParams.set("q", request.query);
      url.searchParams.set("maximum_number_of_urls", String(maxResults));
      if (candidateCount !== undefined) url.searchParams.set("count", String(candidateCount));
      url.searchParams.set("maximum_number_of_tokens", String(maxTokens));
      if (maxSnippets !== undefined) {
        url.searchParams.set("maximum_number_of_snippets", String(maxSnippets));
      }
      if (maxTokensPerUrl !== undefined) {
        url.searchParams.set("maximum_number_of_tokens_per_url", String(maxTokensPerUrl));
      }
      if (maxSnippetsPerUrl !== undefined) {
        url.searchParams.set("maximum_number_of_snippets_per_url", String(maxSnippetsPerUrl));
      }
      if (options.contextThresholdMode) {
        url.searchParams.set("context_threshold_mode", options.contextThresholdMode);
      }
      if (options.country) url.searchParams.set("country", options.country);
      if (options.searchLanguage) url.searchParams.set("search_lang", options.searchLanguage);
      if (options.freshness) url.searchParams.set("freshness", options.freshness);

      const timeoutSignal = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs);
      const signal = timeoutSignal
        ? AbortSignal.any([context.signal, timeoutSignal])
        : context.signal;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": apiKey,
        },
        signal,
      });

      if (!response.ok) {
        const body = (await response.text().catch(() => "")).replaceAll(apiKey, "[REDACTED]");
        throw new Error(
          `Brave Search request failed with status ${response.status}${body ? `: ${body}` : ""}`,
        );
      }

      const data = (await response.json()) as BraveLlmContextResponse;
      const results: WebSearchResult[] = [];
      const items = [
        ...(data.grounding?.generic ?? []),
        ...(data.grounding?.poi ? [data.grounding.poi] : []),
        ...(data.grounding?.map ?? []),
      ];
      for (const item of items) {
        if (results.length >= maxResults) break;
        if (!item.title || !item.url || !item.snippets?.length) continue;
        results.push({ title: item.title, url: item.url, snippets: item.snippets });
      }
      return { results };
    },
  };
}

function requireIntegerInRange(value: number, name: string, min: number, max?: number): number {
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
  if (value < min) throw new Error(`${name} must be greater than or equal to ${min}`);
  if (max !== undefined && value > max) {
    throw new Error(`${name} must be less than or equal to ${max}`);
  }
  return value;
}
