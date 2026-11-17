import type { ModelCatalog, ReasoningConfig, ReasoningSetting } from "@fifthrevision/axle";
import type { Endpoint } from "./agent-config.js";
import type { RequestOptions } from "./configs/schemas.js";
import { catalogLookupOptions } from "./context-window.js";

export const ASSUMED_ON: ReasoningConfig = { effort: "medium" };

export type OnSource = { kind: "catalog"; id: string } | { kind: "assumed" };

export interface ResolvedReasoning {
  setting: ReasoningSetting | undefined;
  /** Present when the recipe said `on`: the setting it became and where that came from. */
  on?: { setting: ReasoningConfig; source: OnSource };
}

/**
 * The reasoning setting a run sends, from the recipe's. `default`, `off` and
 * an effort word are the library settings they name. `on` is the setting the
 * models.dev catalog suggests for the model, else medium. An object is sent
 * as written. Normative in docs/architecture/cli.md.
 */
export function resolveRecipeReasoning(
  endpoint: Endpoint,
  model: string,
  reasoning: RequestOptions["reasoning"],
  catalog: ModelCatalog | undefined,
): ResolvedReasoning {
  if (reasoning === undefined || typeof reasoning === "object") return { setting: reasoning };
  if (reasoning === "default") return { setting: "default" };
  if (reasoning === "off") return { setting: { enabled: false } };
  if (reasoning !== "on") return { setting: { effort: reasoning } };
  const { provider } = catalogLookupOptions(endpoint);
  const found = provider ? catalog?.reasoningControl(model, { provider }) : undefined;
  const on: ResolvedReasoning["on"] = found?.suggested
    ? { setting: found.suggested, source: { kind: "catalog", id: found.id } }
    : { setting: ASSUMED_ON, source: { kind: "assumed" } };
  return { setting: on.setting, on };
}

export function describeOn(on: NonNullable<ResolvedReasoning["on"]>): string {
  const source = on.source.kind === "catalog" ? `models.dev (${on.source.id})` : "assumed";
  return `Reasoning: on is ${on.setting.effort ?? "the model's switch"} (${source})`;
}
