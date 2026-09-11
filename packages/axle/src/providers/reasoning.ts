/**
 * Named reasoning depth. Relative within a model, not comparable compute or
 * token spend across models.
 */
export type ReasoningEffort = "low" | "medium" | "high";

/**
 * Whether the provider should disclose its thinking. The form that comes
 * back (summary or raw) is the model's, not the caller's.
 */
export type ReasoningDisplay = "visible" | "hidden";

/**
 * Provider-portable reasoning control. `"default"` (or omission) sends no
 * reasoning fields; `"off"` sends the provider's explicit disable shape;
 * `"on"` is `{ effort: "medium" }`. `display` (default `"visible"`) asks the
 * provider to disclose its thinking wherever a request field exists.
 * Normative in docs/architecture/reasoning.md.
 */
export type ReasoningSetting =
  "default" | "off" | "on" | { effort: ReasoningEffort; display?: ReasoningDisplay };

export type ReasoningRequest =
  "default" | "off" | { effort: ReasoningEffort; display: ReasoningDisplay };

const REASONING_DISPLAYS: ReadonlySet<string> = new Set(["visible", "hidden"]);

export function resolveReasoning(setting: ReasoningSetting | undefined): ReasoningRequest {
  if (setting === undefined || setting === "default") return "default";
  if (setting === "off") return "off";
  if (setting === "on") return { effort: "medium", display: "visible" };
  if (
    typeof setting === "object" &&
    setting.effort in LEGACY_REASONING_BUDGETS &&
    (setting.display === undefined || REASONING_DISPLAYS.has(setting.display))
  ) {
    return { effort: setting.effort, display: setting.display ?? "visible" };
  }
  throw new TypeError(
    `Unsupported reasoning setting ${JSON.stringify(setting)}; expected "default", "off", "on", or { effort: "low" | "medium" | "high", display?: "visible" | "hidden" }`,
  );
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
