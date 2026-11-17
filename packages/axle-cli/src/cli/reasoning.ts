import type { ModelCatalog, ReasoningEffort, ReasoningSetting } from "@fifthrevision/axle";
import type { Endpoint } from "./agent-config.js";
import { catalogLookupOptions } from "./context-window.js";

export const ASSUMED_ON_EFFORT = "medium";

export type OnEffortSource = { kind: "catalog"; id: string } | { kind: "assumed" };

export interface ResolvedReasoning {
  setting: ReasoningSetting | undefined;
  /** Present when the recipe said `on`: the effort it became and where that came from. */
  on?: { effort: ReasoningEffort; source: OnEffortSource };
}

/**
 * The reasoning setting a run sends. A recipe's `on` becomes the effort the
 * models.dev catalog suggests for the model, else medium; every other
 * setting is sent as written. Normative in docs/architecture/cli.md.
 */
export function resolveRecipeReasoning(
  endpoint: Endpoint,
  model: string,
  setting: ReasoningSetting | undefined,
  catalog: ModelCatalog | undefined,
): ResolvedReasoning {
  const effort = typeof setting === "object" ? setting.effort : setting;
  if (effort !== "on") return { setting };
  const { provider } = catalogLookupOptions(endpoint);
  const found = provider ? catalog?.reasoningControl(model, { provider }) : undefined;
  const on: ResolvedReasoning["on"] = found?.suggested
    ? { effort: found.suggested, source: { kind: "catalog", id: found.id } }
    : { effort: ASSUMED_ON_EFFORT, source: { kind: "assumed" } };
  return {
    setting: typeof setting === "object" ? { ...setting, effort: on.effort } : on.effort,
    on,
  };
}

export function describeOnEffort(on: NonNullable<ResolvedReasoning["on"]>): string {
  const source = on.source.kind === "catalog" ? `models.dev (${on.source.id})` : "assumed";
  return `Reasoning: on is ${on.effort} (${source})`;
}
