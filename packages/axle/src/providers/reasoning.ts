/**
 * Named reasoning depth. Relative within a model, not comparable compute or
 * token spend across models.
 */
export type ReasoningEffort = "low" | "medium" | "high";

/**
 * Provider-portable reasoning control. `"default"` (or omission) sends no
 * reasoning fields; `"off"` sends the provider's explicit disable shape;
 * `"on"` is `{ effort: "medium" }`. Normative in docs/architecture/reasoning.md.
 */
export type ReasoningSetting = "default" | "off" | "on" | { effort: ReasoningEffort };

export type ReasoningRequest = "default" | "off" | ReasoningEffort;

export function resolveReasoning(setting: ReasoningSetting | undefined): ReasoningRequest {
  if (setting === undefined || setting === "default") return "default";
  if (setting === "off") return "off";
  if (setting === "on") return "medium";
  return setting.effort;
}

/**
 * Fixed Axle presets for routes that only accept a thinking token budget.
 * Not derived from any provider's named effort levels.
 */
export const LEGACY_REASONING_BUDGETS: Record<ReasoningEffort, number> = {
  low: 2048,
  medium: 8192,
  high: 16384,
};
