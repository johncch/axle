import { AxleError, AxleErrorCode } from "../errors/AxleError.js";

/**
 * Every named reasoning depth, lowest first. No model accepts all of them;
 * a level a model lacks is rejected by its provider.
 */
export const REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

/**
 * Named reasoning depth. Relative within a model, not comparable compute or
 * token spend across models.
 */
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/**
 * Whether the provider should disclose its thinking. The form that comes
 * back (summary or raw) is the model's, not the caller's.
 */
export type ReasoningDisplay = "visible" | "hidden";

/**
 * Provider-portable reasoning control. `"default"` (or omission) sends no
 * reasoning fields; `"off"` sends the provider's explicit disable shape;
 * `{ effort }` names a level, sent to the provider as written. `display`
 * (default `"visible"`) asks the provider to disclose its thinking wherever
 * a request field exists. Normative in docs/architecture/reasoning.md.
 */
export type ReasoningSetting =
  "default" | "off" | { effort: ReasoningEffort; display?: ReasoningDisplay };

export type ReasoningRequest =
  "default" | "off" | { effort: ReasoningEffort; display: ReasoningDisplay };

const REASONING_DISPLAYS: ReadonlySet<string> = new Set(["visible", "hidden"]);

export function resolveReasoningDisplay(setting: ReasoningSetting | undefined): ReasoningDisplay {
  const request = resolveReasoning(setting);
  return typeof request === "object" ? request.display : "visible";
}

export function resolveReasoning(setting: ReasoningSetting | undefined): ReasoningRequest {
  if (setting === undefined || setting === "default") return "default";
  if (setting === "off") return "off";
  if (
    typeof setting === "object" &&
    setting !== null &&
    (REASONING_EFFORTS as readonly string[]).includes(setting.effort) &&
    (setting.display === undefined || REASONING_DISPLAYS.has(setting.display))
  ) {
    return { effort: setting.effort, display: setting.display ?? "visible" };
  }
  throw new AxleError(
    `Unsupported reasoning setting ${JSON.stringify(setting)}; expected "default", "off", or { effort: ${REASONING_EFFORTS.map((effort) => `"${effort}"`).join(" | ")}, display?: "visible" | "hidden" }`,
    { code: AxleErrorCode.INVALID_OPTIONS },
  );
}

/**
 * Fixed Axle presets for routes that only accept a thinking token budget.
 * Not derived from any provider's named effort levels.
 */
export const LEGACY_REASONING_BUDGETS: Record<ReasoningEffort, number> = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
  xhigh: 20480,
  max: 24576,
};
