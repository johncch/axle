import type {
  AxleAssistantMessage,
  Citation,
  ThinkingContinuity,
} from "../../../messages/message.js";
import type { ProviderTool } from "../../../tools/types.js";
import { resolveReasoning, type ReasoningSetting } from "../../reasoning.js";
import type { ChatCompletionsDialect } from "../dialect.js";
import type { ChatCompletionAnnotation, ChatCompletionReasoningDetail } from "../types.js";
import { normalizeCitation } from "../utils.js";

export type OpenRouterThinkingContinuity = Extract<ThinkingContinuity, { provider: "openrouter" }>;

export const OPENROUTER_SUMMARY_REASONING_FORMATS: ReadonlySet<string> = new Set([
  "anthropic-claude-v1",
  "google-gemini-v1",
]);

export function toOpenRouterReasoning(reasoning: ReasoningSetting | undefined) {
  const request = resolveReasoning(reasoning);
  if (request === "default") return {};
  if (request === "off") return { reasoning_effort: "none" as const };
  if (request.display === "hidden") {
    return { reasoning_effort: request.effort, reasoning: { exclude: true } };
  }
  return { reasoning_effort: request.effort };
}

export function reasoningDetailContentField(
  detail: ChatCompletionReasoningDetail,
): "summary" | "raw" | null {
  if (detail.type === "reasoning.summary") return "summary";
  if (detail.type === "reasoning.text") {
    return detail.format && OPENROUTER_SUMMARY_REASONING_FORMATS.has(detail.format)
      ? "summary"
      : "raw";
  }
  return null;
}

export function reasoningDetailContentText(detail: ChatCompletionReasoningDetail): string {
  return (detail.type === "reasoning.summary" ? detail.summary : detail.text) ?? "";
}

export function reasoningDetailContinuity(
  detail: ChatCompletionReasoningDetail,
  previous?: ThinkingContinuity,
): OpenRouterThinkingContinuity {
  const prior = previous?.provider === "openrouter" ? previous : undefined;
  return {
    ...prior,
    provider: "openrouter",
    type: prior?.type ?? detail.type,
    ...(detail.id ? { id: detail.id } : {}),
    ...(detail.format ? { format: detail.format } : {}),
    ...(detail.index !== undefined ? { index: detail.index } : {}),
    ...(detail.signature ? { signature: detail.signature } : {}),
    ...(detail.data ? { data: detail.data } : {}),
  };
}

export function reasoningDetailCarriesContinuity(detail: ChatCompletionReasoningDetail): boolean {
  return Boolean(detail.signature || detail.id || detail.data);
}

export function reasoningDetailIdentity(
  detail: ChatCompletionReasoningDetail,
): ChatCompletionReasoningDetail {
  return {
    type: detail.type,
    ...(detail.id ? { id: detail.id } : {}),
    ...(detail.format ? { format: detail.format } : {}),
    ...(detail.index !== undefined ? { index: detail.index } : {}),
    ...(detail.signature ? { signature: detail.signature } : {}),
  };
}

export function toOpenRouterReasoningDetails(
  content: AxleAssistantMessage["content"],
): ChatCompletionReasoningDetail[] {
  const details: ChatCompletionReasoningDetail[] = [];
  for (const part of content) {
    if (part.type !== "thinking" || part.continuity?.provider !== "openrouter") continue;
    const continuity = part.continuity;
    if (!continuity.signature && !continuity.data) continue;
    const detail: ChatCompletionReasoningDetail = {
      type: continuity.type,
      ...(continuity.id ? { id: continuity.id } : {}),
      ...(continuity.format ? { format: continuity.format } : {}),
      ...(continuity.index !== undefined ? { index: continuity.index } : {}),
      ...(continuity.signature ? { signature: continuity.signature } : {}),
    };
    if (continuity.type === "reasoning.summary") detail.summary = part.summary ?? "";
    else if (continuity.type === "reasoning.encrypted") detail.data = continuity.data ?? "";
    else detail.text = part.summary ?? part.text ?? "";
    details.push(detail);
    if (continuity.type !== "reasoning.encrypted" && continuity.data) {
      details.push({
        type: "reasoning.encrypted",
        ...(continuity.id ? { id: continuity.id } : {}),
        ...(continuity.format ? { format: continuity.format } : {}),
        ...(continuity.index !== undefined ? { index: continuity.index } : {}),
        data: continuity.data,
      });
    }
  }
  return details;
}

const OPENROUTER_SERVER_TOOL_MAP: Record<string, string> = {
  web_search: "openrouter:web_search",
};

export function resolveOpenRouterProviderToolName(name: string): string | undefined {
  return OPENROUTER_SERVER_TOOL_MAP[name];
}

export function prepareOpenRouterProviderTools(
  providerTools: Array<ProviderTool>,
  warn?: (message: string, attributes?: Record<string, unknown>) => void,
): any[] | undefined {
  const mappedTools: any[] = [];

  for (const tool of providerTools) {
    const mappedType = resolveOpenRouterProviderToolName(tool.name);
    if (!mappedType) {
      warn?.("providerTool not supported by ChatCompletions provider vendor", {
        vendor: "openrouter",
        name: tool.name,
      });
      continue;
    }

    mappedTools.push({
      type: mappedType,
      ...(tool.config ? { parameters: tool.config } : {}),
    });
  }

  return mappedTools.length > 0 ? mappedTools : undefined;
}

export function openRouterCitation(annotation: ChatCompletionAnnotation): Citation | null {
  const citation = normalizeCitation(annotation);
  const citedText = annotation.url_citation?.content;
  if (!citation || citation.source.type !== "web" || citedText === undefined) return citation;
  return { ...citation, source: { ...citation.source, citedText } };
}

export function toOpenRouterRequestFields(fields: {
  sessionId: string | undefined;
  cache: boolean | undefined;
}) {
  return {
    ...(fields.sessionId !== undefined ? { session_id: fields.sessionId } : {}),
    ...(fields.cache !== false ? { cache_control: { type: "ephemeral" as const } } : {}),
  };
}

export const openrouterDialect: ChatCompletionsDialect = {
  reasoning: toOpenRouterReasoning,
  requestFields: toOpenRouterRequestFields,
  providerTools: prepareOpenRouterProviderTools,
  reasoningDetails: {
    toRequest: toOpenRouterReasoningDetails,
    contentField: reasoningDetailContentField,
    contentText: reasoningDetailContentText,
    continuity: reasoningDetailContinuity,
    carriesContinuity: reasoningDetailCarriesContinuity,
    identity: reasoningDetailIdentity,
  },
  citation: openRouterCitation,
};
