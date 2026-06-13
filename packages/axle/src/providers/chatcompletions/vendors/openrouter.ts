import type { Citation } from "../../../messages/message.js";
import type { ResolvedProviderTool } from "../../types.js";
import type { ChatCompletionAnnotation } from "../types.js";

const OPENROUTER_SERVER_TOOL_MAP: Record<string, string> = {
  web_search: "openrouter:web_search",
};

export function resolveOpenRouterProviderToolName(name: string): string | undefined {
  return OPENROUTER_SERVER_TOOL_MAP[name];
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
