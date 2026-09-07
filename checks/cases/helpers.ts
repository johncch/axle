import type { AxleAssistantMessage } from "@fifthrevision/axle";
import type { CheckCaseResult } from "./types.js";

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
