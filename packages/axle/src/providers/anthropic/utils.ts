import Anthropic from "@anthropic-ai/sdk";
import z from "zod";
import { AxleMessage, Citation, type ToolResultPart } from "../../messages/message.js";
import type { ToolDefinition } from "../../tools/types.js";
import {
  type FileInfo,
  type FileResolver,
  type ResolvedFileSource,
  resolveFileSource,
} from "../../utils/file.js";
import {
  LEGACY_REASONING_BUDGETS,
  type ReasoningEffort,
  type ReasoningSetting,
  resolveReasoning,
} from "../reasoning.js";
import { AxleStopReason, type ResolvedProviderTool, ToolChoice } from "../types.js";

interface AnthropicConversionContext {
  model: string;
  fileResolver?: FileResolver;
  signal?: AbortSignal;
}

export async function convertToProviderMessages(
  messages: Array<AxleMessage>,
  context: AnthropicConversionContext = { model: "" },
): Promise<Array<Anthropic.MessageParam>> {
  return Promise.all(messages.map((msg) => convertMessage(msg, context)));
}

async function convertMessage(
  msg: AxleMessage,
  context: AnthropicConversionContext,
): Promise<Anthropic.MessageParam> {
  if (msg.role === "assistant") {
    const content: Array<Anthropic.ContentBlockParam> = [];
    for (const part of msg.content) {
      if (part.type === "text") {
        const citations = part.citations?.flatMap(
          (citation) => toAnthropicCitation(citation) ?? [],
        );
        content.push({
          type: "text",
          text: part.text,
          ...(citations?.length ? { citations } : {}),
        });
      } else if (part.type === "thinking") {
        const continuity = part.continuity?.provider === "anthropic" ? part.continuity : undefined;
        if (part.redacted) {
          content.push({
            type: "redacted_thinking",
            data: continuity?.redactedData ?? part.text ?? "",
          });
        } else if (continuity?.signature) {
          content.push({
            type: "thinking",
            thinking: part.summary ?? part.text ?? "",
            signature: continuity.signature,
          });
        }
      } else if (part.type === "tool-call") {
        content.push({
          type: "tool_use",
          id: part.id,
          name: part.name,
          input: part.parameters,
        } satisfies Anthropic.ToolUseBlockParam);
      } else if (part.type === "provider-tool") {
        if (part.continuity?.provider !== "anthropic") continue;
        content.push(part.continuity.call);
        if (part.continuity.result) content.push(part.continuity.result);
      } else if (part.type === "provider-tool-result") {
        if (part.continuity?.provider === "anthropic") content.push(part.continuity.result);
      }
    }
    return {
      role: "assistant",
      content,
    };
  }

  if (msg.role === "tool") {
    return {
      role: "user",
      content: (await Promise.all(
        msg.content.map(async (r) => ({
          type: "tool_result" as const,
          tool_use_id: r.id,
          content:
            typeof r.content === "string"
              ? r.content
              : await convertToolResultParts(r.content, context),
          ...(r.isError ? { is_error: true } : {}),
        })),
      )) satisfies Array<Anthropic.ToolResultBlockParam>,
    } satisfies Anthropic.MessageParam;
  }

  if (typeof msg.content === "string") {
    return {
      role: "user",
      content: msg.content,
    } satisfies Anthropic.MessageParam;
  } else {
    const content: Array<
      Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam
    > = [];

    for (const part of msg.content) {
      if (part.type === "text") {
        content.push({
          type: "text",
          text: part.text,
        } satisfies Anthropic.TextBlockParam);
      } else if (part.type === "file") {
        content.push(await convertFilePart(part.file, context, "user-message"));
      }
    }

    return {
      role: "user",
      content,
    } satisfies Anthropic.MessageParam;
  }
}

async function convertFilePart(
  file: FileInfo,
  context: AnthropicConversionContext,
  purpose: "user-message" | "tool-result",
): Promise<Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam | Anthropic.TextBlockParam> {
  if (file.kind === "image") {
    const resolved = await resolveFileSource(file, {
      provider: "anthropic",
      model: context.model,
      accepted: ["url", "base64"],
      purpose,
      resolver: context.fileResolver,
      signal: context.signal,
    });
    return {
      type: "image",
      source: toAnthropicImageSource(resolved, file),
    } satisfies Anthropic.ImageBlockParam;
  }

  if (file.kind === "document") {
    if (file.mimeType !== "application/pdf") {
      throw new Error(`Anthropic only supports PDF document files. Received ${file.mimeType}`);
    }
    const resolved = await resolveFileSource(file, {
      provider: "anthropic",
      model: context.model,
      accepted: ["url", "base64"],
      purpose,
      resolver: context.fileResolver,
      signal: context.signal,
    });
    return {
      type: "document",
      source: toAnthropicPdfSource(resolved),
      title: resolved.name ?? file.name,
      citations: { enabled: true },
    } satisfies Anthropic.DocumentBlockParam;
  }

  const resolved = await resolveFileSource(file, {
    provider: "anthropic",
    model: context.model,
    accepted: ["text"],
    purpose,
    resolver: context.fileResolver,
    signal: context.signal,
  });
  if (resolved.type !== "text") {
    throw new Error(`Unsupported Anthropic text source: ${resolved.type}`);
  }

  if (purpose === "tool-result") {
    return { type: "text", text: resolved.content } satisfies Anthropic.TextBlockParam;
  }

  return {
    type: "document",
    source: {
      type: "text",
      media_type: "text/plain",
      data: resolved.content,
    },
    title: resolved.name ?? file.name,
    citations: { enabled: true },
  } satisfies Anthropic.DocumentBlockParam;
}

type AnthropicImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function toAnthropicImageMediaType(mimeType: string): AnthropicImageMediaType {
  if (
    mimeType === "image/jpeg" ||
    mimeType === "image/png" ||
    mimeType === "image/gif" ||
    mimeType === "image/webp"
  ) {
    return mimeType;
  }
  throw new Error(
    `Anthropic does not support image MIME type: ${mimeType}. Supported types: image/jpeg, image/png, image/gif, image/webp.`,
  );
}

function toAnthropicImageSource(
  resolved: ResolvedFileSource,
  file: FileInfo,
): Anthropic.ImageBlockParam["source"] {
  if (resolved.type === "url") {
    return { type: "url", url: resolved.url };
  }
  if (resolved.type === "base64") {
    return {
      type: "base64",
      media_type: toAnthropicImageMediaType(resolved.mimeType ?? file.mimeType),
      data: resolved.data,
    };
  }
  throw new Error(`Unsupported Anthropic image source: ${resolved.type}`);
}

function toAnthropicPdfSource(
  resolved: ResolvedFileSource,
): Anthropic.DocumentBlockParam["source"] {
  if (resolved.type === "url") {
    return { type: "url", url: resolved.url };
  }
  if (resolved.type === "base64") {
    return {
      type: "base64",
      media_type: "application/pdf",
      data: resolved.data,
    };
  }
  throw new Error(`Unsupported Anthropic PDF source: ${resolved.type}`);
}

type AnthropicThinkingDisplay = "summarized" | "omitted";

export type AnthropicThinkingFields =
  | Record<string, never>
  | { thinking: { type: "disabled" } }
  | { thinking: { type: "enabled"; budget_tokens: number; display: AnthropicThinkingDisplay } }
  | {
      thinking: { type: "adaptive"; display: AnthropicThinkingDisplay };
      output_config: { effort: ReasoningEffort };
    };

export function toAnthropicThinking(
  reasoning: ReasoningSetting | undefined,
  model = "",
): AnthropicThinkingFields {
  const request = resolveReasoning(reasoning);
  if (request === "default") return {};
  if (request === "off") return { thinking: { type: "disabled" } };
  const display: AnthropicThinkingDisplay =
    request.display === "visible" ? "summarized" : "omitted";
  if (usesAnthropicThinkingBudget(model)) {
    return {
      thinking: {
        type: "enabled",
        budget_tokens: LEGACY_REASONING_BUDGETS[request.effort],
        display,
      },
    };
  }
  return {
    thinking: { type: "adaptive", display },
    output_config: { effort: request.effort },
  };
}

/**
 * Every Claude ID that only accepts `thinking.type: enabled` with a token
 * budget. Anything else, including unknown IDs, takes the adaptive route.
 */
export const ANTHROPIC_THINKING_BUDGET_MODELS: ReadonlySet<string> = new Set([
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-5",
  "claude-opus-4-5-20251101",
  "claude-sonnet-4-5",
  "claude-sonnet-4-5-20250929",
]);

function usesAnthropicThinkingBudget(model: string): boolean {
  return ANTHROPIC_THINKING_BUDGET_MODELS.has(model.toLowerCase());
}

const ANTHROPIC_64K_OUTPUT_MODELS: ReadonlySet<string> = new Set([
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-5",
  "claude-opus-4-5-20251101",
  "claude-sonnet-4-5",
  "claude-sonnet-4-5-20250929",
]);

const ANTHROPIC_STREAM_MAX_TOKENS = 128_000;
const ANTHROPIC_STREAM_64K_MAX_TOKENS = 64_000;

export function getAnthropicStreamMaxTokens(model: string): number {
  return ANTHROPIC_64K_OUTPUT_MODELS.has(model.toLowerCase())
    ? ANTHROPIC_STREAM_64K_MAX_TOKENS
    : ANTHROPIC_STREAM_MAX_TOKENS;
}

export function convertToAnthropicTools(
  tools: Array<ToolDefinition>,
): Array<Anthropic.Messages.Tool> {
  return tools.map((tool) => {
    const schema = z.toJSONSchema(tool.schema);
    if (!isObjectSchema(schema)) {
      throw new Error(`Schema for tool ${tool.name} must be an object type`);
    }
    return {
      name: tool.name,
      description: tool.description,
      input_schema: schema,
    };
  });
}

const PROVIDER_TOOL_MAP: Record<string, string> = {
  web_search: "web_search_20260318",
  code_execution: "code_execution_20260521",
};

const PROVIDER_TOOL_DEFAULT_CONFIG: Record<string, Record<string, unknown>> = {
  web_search: { allowed_callers: ["direct"] },
};

export function resolveAnthropicProviderToolName(name: string): string {
  return PROVIDER_TOOL_MAP[name] ?? name;
}

export function convertToAnthropicProviderTools(
  providerTools?: Array<ResolvedProviderTool>,
): any[] {
  return (providerTools ?? []).map((tool) => ({
    type: tool.nativeName ?? resolveAnthropicProviderToolName(tool.name),
    name: tool.name,
    ...PROVIDER_TOOL_DEFAULT_CONFIG[tool.name],
    ...tool.config,
  }));
}

export function toAnthropicToolChoice(
  choice: ToolChoice | undefined,
  parallelToolCalls: boolean | undefined,
  tools?: Array<ToolDefinition>,
  providerTools?: Array<ResolvedProviderTool>,
) {
  if (choice === undefined && parallelToolCalls !== false) return {};

  const disable = parallelToolCalls === false ? { disable_parallel_tool_use: true } : {};
  if (choice === undefined || choice === "auto") {
    return { tool_choice: { type: "auto" as const, ...disable } };
  }
  if (choice === "required") return { tool_choice: { type: "any" as const, ...disable } };
  if (choice === "none") return { tool_choice: { type: "none" as const } };

  const exists =
    tools?.some((tool) => tool.name === choice.name) ||
    providerTools?.some((tool) => tool.name === choice.name);
  if (!exists) throw new Error(`Tool choice references an unavailable tool: ${choice.name}`);
  return { tool_choice: { type: "tool" as const, name: choice.name, ...disable } };
}

export function findOpenProviderToolCalls(
  messages: Array<AxleMessage>,
): Array<{ id: string; name: string }> {
  const openCallNames = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.content) {
      if (part.type === "provider-tool" && !part.result) {
        openCallNames.set(part.id, part.name);
      } else if (part.type === "provider-tool-result") {
        openCallNames.delete(part.id);
      }
    }
  }
  return [...openCallNames].map(([id, name]) => ({ id, name }));
}

export function normalizeAnthropicCitation(citation: Anthropic.Messages.TextCitation): Citation {
  switch (citation.type) {
    case "char_location":
      return {
        source: {
          type: "document",
          title: citation.document_title ?? undefined,
          fileId: citation.file_id ?? undefined,
          citedText: citation.cited_text,
          locator: {
            type: "char",
            start: citation.start_char_index,
            end: citation.end_char_index,
          },
        },
        providerMetadata: {
          type: citation.type,
          documentIndex: citation.document_index,
        },
      };
    case "page_location":
      return {
        source: {
          type: "document",
          title: citation.document_title ?? undefined,
          fileId: citation.file_id ?? undefined,
          citedText: citation.cited_text,
          locator: {
            type: "page",
            start: citation.start_page_number,
            end: citation.end_page_number,
          },
        },
        providerMetadata: {
          type: citation.type,
          documentIndex: citation.document_index,
        },
      };
    case "content_block_location":
      return {
        source: {
          type: "document",
          title: citation.document_title ?? undefined,
          fileId: citation.file_id ?? undefined,
          citedText: citation.cited_text,
          locator: {
            type: "block",
            start: citation.start_block_index,
            end: citation.end_block_index,
          },
        },
        providerMetadata: {
          type: citation.type,
          documentIndex: citation.document_index,
        },
      };
    case "web_search_result_location":
      return {
        source: {
          type: "web",
          title: citation.title ?? undefined,
          url: citation.url,
          citedText: citation.cited_text,
        },
        providerMetadata: { type: citation.type, encryptedIndex: citation.encrypted_index },
      };
    case "search_result_location":
      return {
        source: {
          type: "search-result",
          title: citation.title ?? undefined,
          url: citation.source,
          citedText: citation.cited_text,
          locator: {
            type: "block",
            start: citation.start_block_index,
            end: citation.end_block_index,
          },
        },
        providerMetadata: {
          type: citation.type,
          searchResultIndex: citation.search_result_index,
        },
      };
  }
}

function toAnthropicCitation(citation: Citation): Anthropic.TextCitationParam | undefined {
  const { source, providerMetadata } = citation;
  switch (providerMetadata?.type) {
    case "char_location":
      if (source.type !== "document" || source.locator?.type !== "char") return undefined;
      return {
        type: "char_location",
        cited_text: source.citedText as string,
        document_index: providerMetadata.documentIndex as number,
        document_title: source.title ?? null,
        start_char_index: source.locator.start as number,
        end_char_index: source.locator.end as number,
      };
    case "page_location":
      if (source.type !== "document" || source.locator?.type !== "page") return undefined;
      return {
        type: "page_location",
        cited_text: source.citedText as string,
        document_index: providerMetadata.documentIndex as number,
        document_title: source.title ?? null,
        start_page_number: source.locator.start as number,
        end_page_number: source.locator.end as number,
      };
    case "content_block_location":
      if (source.type !== "document" || source.locator?.type !== "block") return undefined;
      return {
        type: "content_block_location",
        cited_text: source.citedText as string,
        document_index: providerMetadata.documentIndex as number,
        document_title: source.title ?? null,
        start_block_index: source.locator.start as number,
        end_block_index: source.locator.end as number,
      };
    case "web_search_result_location":
      if (source.type !== "web") return undefined;
      return {
        type: "web_search_result_location",
        cited_text: source.citedText as string,
        encrypted_index: providerMetadata.encryptedIndex as string,
        title: source.title ?? null,
        url: source.url,
      };
    case "search_result_location":
      if (source.type !== "search-result" || source.locator?.type !== "block") return undefined;
      return {
        type: "search_result_location",
        cited_text: source.citedText as string,
        search_result_index: providerMetadata.searchResultIndex as number,
        source: source.url as string,
        title: source.title ?? null,
        start_block_index: source.locator.start as number,
        end_block_index: source.locator.end as number,
      };
    default:
      return undefined;
  }
}

export function convertStopReason(reason: Anthropic.StopReason): AxleStopReason | undefined {
  switch (reason) {
    case "max_tokens":
    case "model_context_window_exceeded":
      return AxleStopReason.Length;
    case "end_turn":
    case "stop_sequence":
      return AxleStopReason.Stop;
    case "tool_use":
      return AxleStopReason.FunctionCall;
    default:
      return undefined;
  }
}

function isObjectSchema(schema: any): schema is { type: "object"; [key: string]: any } {
  return schema && typeof schema === "object" && schema.type === "object";
}

async function convertToolResultParts(
  parts: ToolResultPart[],
  context: AnthropicConversionContext,
): Promise<
  Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam>
> {
  return Promise.all(
    parts.map(async (part) => {
      if (part.type === "text") {
        return { type: "text" as const, text: part.text };
      }
      return convertFilePart(part.file, context, "tool-result");
    }),
  );
}
