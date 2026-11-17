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
 * The knobs a model's thinking can have, each sent as its provider spells
 * it. A knob the model or provider lacks is rejected, by the provider or,
 * where there is no field to send, by Axle.
 */
export interface ReasoningConfig {
  /**
   * The model's on/off switch. `false` sends the provider's explicit
   * disable. `true` on its own turns thinking on without naming a depth,
   * where the provider has a switch.
   */
  enabled?: boolean;
  /** The depth to think at. Naming one turns thinking on. */
  effort?: ReasoningEffort;
  /** Defaults to `"visible"`. */
  display?: ReasoningDisplay;
}

/**
 * Reasoning control. `"default"` (or omission) sends no reasoning fields and
 * the model runs at its provider's default. Normative in
 * docs/architecture/reasoning.md.
 */
export type ReasoningSetting = "default" | ReasoningConfig;

/** `effort` absent means the switch alone: on, with no depth named. */
export type ReasoningRequest =
  "default" | "off" | { effort?: ReasoningEffort; display: ReasoningDisplay };

const REASONING_DISPLAYS: readonly unknown[] = ["visible", "hidden"];
const REASONING_KEYS: readonly string[] = ["enabled", "effort", "display"];

function invalid(setting: unknown, problem: string): AxleError {
  return new AxleError(
    `Unsupported reasoning setting ${JSON.stringify(setting)}: ${problem}. Expected "default" or { enabled?: boolean, effort?: ${REASONING_EFFORTS.map((effort) => `"${effort}"`).join(" | ")}, display?: "visible" | "hidden" }`,
    { code: AxleErrorCode.INVALID_OPTIONS },
  );
}

export function resolveReasoningDisplay(setting: ReasoningSetting | undefined): ReasoningDisplay {
  const request = resolveReasoning(setting);
  return typeof request === "object" ? request.display : "visible";
}

export function resolveReasoning(setting: ReasoningSetting | undefined): ReasoningRequest {
  if (setting === undefined || setting === "default") return "default";
  if (typeof setting !== "object" || setting === null || Array.isArray(setting)) {
    throw invalid(setting, "it is not an object");
  }
  const unknown = Object.keys(setting).find((key) => !REASONING_KEYS.includes(key));
  if (unknown !== undefined) throw invalid(setting, `unknown key ${unknown}`);
  const { enabled, effort, display } = setting;
  if (enabled !== undefined && typeof enabled !== "boolean") {
    throw invalid(setting, "enabled is not a boolean");
  }
  if (effort !== undefined && !(REASONING_EFFORTS as readonly unknown[]).includes(effort)) {
    throw invalid(setting, "unknown effort");
  }
  if (display !== undefined && !REASONING_DISPLAYS.includes(display)) {
    throw invalid(setting, "unknown display");
  }
  if (enabled === false) {
    if (effort !== undefined) throw invalid(setting, "enabled is false and an effort is named");
    return "off";
  }
  if (enabled === undefined && effort === undefined) {
    throw invalid(setting, "it sets neither enabled nor effort");
  }
  return { effort, display: display ?? "visible" };
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

/** The error for `{ enabled: true }` alone on a route with no switch to send. */
export function reasoningNeedsEffort(route: string): AxleError {
  return new AxleError(
    `Reasoning { enabled: true } needs an effort on ${route}, which has no switch that turns thinking on without one. Name an effort (${REASONING_EFFORTS.join(", ")})`,
    { code: AxleErrorCode.INVALID_OPTIONS },
  );
}

export function legacyReasoningBudget(effort: ReasoningEffort | undefined, model: string): number {
  if (effort === undefined) throw reasoningNeedsEffort(`${model}, which only takes a token budget`);
  return LEGACY_REASONING_BUDGETS[effort];
}
