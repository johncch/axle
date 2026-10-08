import type { ContextWindowMatch } from "@fifthrevision/axle";
import { inferChatCompletionsVendor, ModelCatalog } from "@fifthrevision/axle";
import { join } from "node:path";
import { resolveConfigDirs } from "./configs/paths.js";

export const ASSUMED_CONTEXT_WINDOW = 200_000;

export interface Endpoint {
  type: string;
  config: Record<string, unknown>;
}

export type ContextWindowSource =
  | { kind: "provider" }
  | { kind: "catalog"; id: string; match: ContextWindowMatch["match"] }
  | { kind: "assumed" };

export interface ResolvedContextWindow {
  window: number;
  source: ContextWindowSource;
}

export function modelCatalogPath(home?: string): string {
  return join(resolveConfigDirs({ home }).user, "cache", "models.json");
}

export function openModelCatalog(home?: string): Promise<ModelCatalog> {
  return ModelCatalog.open({ cachePath: modelCatalogPath(home) });
}

const FIRST_PARTY_PUBLISHERS: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai",
  gemini: "google",
};

const VENDOR_HOSTS = { openrouter: "openrouter", together: "togetherai" } as const;

/** The models.dev provider id for an endpoint, when the endpoint says which service it is. */
export function catalogHost(endpoint: Endpoint): string | undefined {
  if (endpoint.type !== "chatcompletions") return FIRST_PARTY_PUBLISHERS[endpoint.type];
  const { vendor, baseUrl } = endpoint.config;
  if (vendor === "openrouter" || vendor === "together") return VENDOR_HOSTS[vendor];
  const inferred = typeof baseUrl === "string" ? inferChatCompletionsVendor(baseUrl) : undefined;
  return inferred ? VENDOR_HOSTS[inferred] : undefined;
}

/**
 * The context window for a run: the endpoint's `contextWindow` if set, else
 * the models.dev catalog, else an assumed 200,000. Normative in
 * docs/architecture/cli.md.
 */
export function resolveContextWindow(
  endpoint: Endpoint,
  model: string,
  catalog: ModelCatalog,
): ResolvedContextWindow {
  const configured = endpoint.config.contextWindow;
  if (typeof configured === "number") return { window: configured, source: { kind: "provider" } };
  const found = catalog.contextWindow(model, {
    host: catalogHost(endpoint),
    publisher: FIRST_PARTY_PUBLISHERS[endpoint.type],
  });
  if (found) {
    return { window: found.window, source: { kind: "catalog", id: found.id, match: found.match } };
  }
  return { window: ASSUMED_CONTEXT_WINDOW, source: { kind: "assumed" } };
}

export function describeContextWindowSource(source: ContextWindowSource): string {
  switch (source.kind) {
    case "provider":
      return "provider config";
    case "catalog":
      return `models.dev (${source.id})`;
    case "assumed":
      return "assumed";
  }
}

export function formatTokens(count: number): string {
  return count.toLocaleString("en-US");
}
