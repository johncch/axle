import type { ContextWindowMatch } from "@fifthrevision/axle";
import { ModelCatalog } from "@fifthrevision/axle";
import { join } from "node:path";
import type { Endpoint } from "./agent-config.js";
import { createProvider } from "./agent-config.js";
import { resolveConfigDirs } from "./configs/paths.js";

export const ASSUMED_CONTEXT_WINDOW = 200_000;

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

export function openModelCatalog(home?: string): ModelCatalog {
  return ModelCatalog.open({ cachePath: modelCatalogPath(home) });
}

const FIRST_PARTY_PUBLISHERS: Partial<Record<string, string>> = {
  anthropic: "anthropic",
  openai: "openai",
  gemini: "google",
};

// Building a provider makes no request, so the key is never used.
const CATALOG_LOOKUP_KEY = "catalog-lookup";

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
  if (configured !== undefined) return { window: configured, source: { kind: "provider" } };
  const found = catalog.contextWindow(model, {
    provider: createProvider(endpoint, CATALOG_LOOKUP_KEY).id,
    publisher: endpoint.kind === "preset" ? FIRST_PARTY_PUBLISHERS[endpoint.preset] : undefined,
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
