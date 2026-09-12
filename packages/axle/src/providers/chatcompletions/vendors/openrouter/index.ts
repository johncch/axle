import type {
  AxleAssistantMessage,
  Citation,
  ContentPartThinking,
  ThinkingContinuity,
} from "../../../../messages/message.js";
import { resolveReasoning, type ReasoningSetting } from "../../../reasoning.js";
import type { ResolvedProviderTool } from "../../../types.js";
import type { ChatCompletionAnnotation, ChatCompletionReasoningDetail } from "../../types.js";
import { OpenRouterModelAliases } from "./models.generated.js";

export type OpenRouterThinkingContinuity = Extract<ThinkingContinuity, { provider: "openrouter" }>;

/**
 * `reasoning.text` formats whose upstream never discloses raw reasoning, so
 * the text is a summary. Bounded set, extended as formats are observed.
 */
export const OPENROUTER_SUMMARY_REASONING_FORMATS: ReadonlySet<string> = new Set([
  "anthropic-claude-v1",
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
  previous?: OpenRouterThinkingContinuity,
): OpenRouterThinkingContinuity {
  return {
    ...previous,
    provider: "openrouter",
    type: previous?.type ?? detail.type,
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

export function reasoningDetailsToThinkingParts(
  details: ChatCompletionReasoningDetail[],
): ContentPartThinking[] {
  const parts: ContentPartThinking[] = [];
  const byIndex = new Map<number, ContentPartThinking>();
  for (const detail of details) {
    let part = detail.index !== undefined ? byIndex.get(detail.index) : undefined;
    if (!part) {
      part = {
        type: "thinking",
        ...(detail.id ? { id: detail.id } : {}),
        continuity: reasoningDetailContinuity(detail),
        providerMetadata: { reasoningDetail: detail },
      };
      parts.push(part);
      if (detail.index !== undefined) byIndex.set(detail.index, part);
    } else if (part.continuity?.provider === "openrouter") {
      part.continuity = reasoningDetailContinuity(detail, part.continuity);
    }
    if (detail.type === "reasoning.encrypted") part.redacted = true;
    const text = reasoningDetailContentText(detail);
    if (!text) continue;
    const field = reasoningDetailContentField(detail);
    if (field === "summary") part.summary = (part.summary ?? "") + text;
    if (field === "raw") part.text = (part.text ?? "") + text;
  }
  return parts;
}

export function toOpenRouterReasoningDetails(
  content: AxleAssistantMessage["content"],
): ChatCompletionReasoningDetail[] {
  const details: ChatCompletionReasoningDetail[] = [];
  for (const part of content) {
    if (part.type !== "thinking" || part.continuity?.provider !== "openrouter") continue;
    const continuity = part.continuity;
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
  }
  return details;
}

const OPENROUTER_SERVER_TOOL_MAP: Record<string, string> = {
  web_search: "openrouter:web_search",
};

export function resolveOpenRouterProviderToolName(name: string): string | undefined {
  return OPENROUTER_SERVER_TOOL_MAP[name];
}

/**
 * Translate a publisher-qualified model identity into the slug OpenRouter's API
 * expects. Mirrors how first-party providers call resolveFirstPartyModel: the
 * catalog holds identity, the provider normalizes to its own wire id at request
 * time. Unknown ids (already OpenRouter slugs, or models we don't catalog) pass
 * through unchanged.
 */
export function resolveOpenRouterModel(model: string): string {
  return OpenRouterModelAliases[model] ?? model;
}

export function prepareOpenRouterProviderTools(
  providerTools: Array<ResolvedProviderTool>,
  warn?: (message: string, attributes?: Record<string, unknown>) => void,
): any[] | undefined {
  const mappedTools: any[] = [];

  for (const tool of providerTools) {
    const mappedType = tool.nativeName ?? resolveOpenRouterProviderToolName(tool.name);
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

export function normalizeOpenRouterCitation(annotation: ChatCompletionAnnotation): Citation | null {
  switch (annotation.type) {
    case "url_citation": {
      const citation = annotation.url_citation;
      if (!citation?.url) return null;
      return {
        source: {
          type: "web",
          title: citation.title,
          url: citation.url,
          citedText: citation.content,
        },
        outputSpan: { start: citation.start_index, end: citation.end_index },
        providerMetadata: { type: annotation.type },
      };
    }
    default:
      return null;
  }
}

export function isOpenRouterTextAnchoredCitation(citation: Citation): boolean {
  const span = citation.outputSpan;
  if (!span) return false;
  if (span.start === undefined && span.end === undefined) return false;
  return span.start !== 0 || span.end !== 0;
}
