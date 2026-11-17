import { AxleError, AxleErrorCode } from "../errors/AxleError.js";

/**
 * Every named reasoning depth, lowest first. No model accepts all of them;
 * a level a model lacks is rejected by its provider.
 */
export const REASONING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** A named reasoning depth. Relative within a model, not comparable across models. */
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

/** Every word a reasoning setting can name: `off`, `on`, then the levels lowest first. */
export const REASONING_EFFORTS = ["off", "on", ...REASONING_LEVELS] as const;

/**
 * What to ask of a model's thinking. `"off"` is the provider's explicit
 * disable. `"on"` is for a model whose thinking only switches on or off and
 * is sent as the provider's own switch where it has one. A level is sent as
 * written.
 */
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/**
 * Whether the provider should disclose its thinking. The form that comes
 * back (summary or raw) is the model's, not the caller's.
 */
export type ReasoningDisplay = "visible" | "hidden";

/**
 * Provider-portable reasoning control: `"default"` (or omission) sends no
 * reasoning fields; an effort word, alone or as `{ effort }`, is sent to the
 * provider. `display` (default `"visible"`) asks the provider to disclose
 * its thinking wherever a request field exists. Normative in
 * docs/architecture/reasoning.md.
 */
export type ReasoningSetting =
  "default" | ReasoningEffort | { effort: ReasoningEffort; display?: ReasoningDisplay };

export type ReasoningRequest =
  "default" | "off" | { effort: Exclude<ReasoningEffort, "off">; display: ReasoningDisplay };

const REASONING_DISPLAYS: ReadonlySet<string> = new Set(["visible", "hidden"]);

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return (REASONING_EFFORTS as readonly unknown[]).includes(value);
}

export function resolveReasoningDisplay(setting: ReasoningSetting | undefined): ReasoningDisplay {
  const request = resolveReasoning(setting);
  return typeof request === "object" ? request.display : "visible";
}

export function resolveReasoning(setting: ReasoningSetting | undefined): ReasoningRequest {
  if (setting === undefined || setting === "default") return "default";
  if (isReasoningEffort(setting)) {
    return setting === "off" ? "off" : { effort: setting, display: "visible" };
  }
  if (
    typeof setting === "object" &&
    setting !== null &&
    isReasoningEffort(setting.effort) &&
    (setting.display === undefined || REASONING_DISPLAYS.has(setting.display))
  ) {
    return setting.effort === "off"
      ? "off"
      : { effort: setting.effort, display: setting.display ?? "visible" };
  }
  const efforts = REASONING_EFFORTS.map((effort) => `"${effort}"`).join(" | ");
  throw new AxleError(
    `Unsupported reasoning setting ${JSON.stringify(setting)}; expected "default", an effort (${efforts}), or { effort, display?: "visible" | "hidden" }`,
    { code: AxleErrorCode.INVALID_OPTIONS },
  );
}

/**
 * Fixed Axle presets for routes that only accept a thinking token budget.
 * Not derived from any provider's named effort levels.
 */
export const LEGACY_REASONING_BUDGETS: Record<ReasoningLevel, number> = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
  xhigh: 20480,
  max: 24576,
};

export function legacyReasoningBudget(
  effort: Exclude<ReasoningEffort, "off">,
  model: string,
): number {
  if (effort === "on") {
    throw new AxleError(
      `Reasoning "on" has no token budget, and ${model} only takes a budget; name a level (${REASONING_LEVELS.join(", ")})`,
      { code: AxleErrorCode.INVALID_OPTIONS },
    );
  }
  return LEGACY_REASONING_BUDGETS[effort];
}
