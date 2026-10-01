import type { AxleAssistantMessage } from "@fifthrevision/axle";
import type { CheckCaseResult } from "./types.js";

// Trivial prompts often produce no thinking; tracing code with the working
// forbidden from the reply pushes the reasoning into a thinking part.
export const reasoningPrompt = [
  "Predict what this function returns for f([3, 1, 4, 1, 5, 9, 2, 6]).",
  "",
  "function f(xs) {",
  "  let acc = 0;",
  "  for (let i = 0; i < xs.length; i++) {",
  "    if (i % 2 === 0) acc = acc * 2 + xs[i];",
  "    else acc = acc - xs[i];",
  "    if (acc % 3 === 0) acc += i;",
  "  }",
  "  return acc;",
  "}",
  "",
  "Reply with only the number, with no explanation.",
].join("\n");

export function fail(details: Record<string, unknown>): CheckCaseResult {
  return { ok: false, details };
}

export function getAssistantText(message: AxleAssistantMessage | undefined): string {
  if (!message) return "";
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}
