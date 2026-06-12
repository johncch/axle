import Anthropic from "@anthropic-ai/sdk";
import z from "zod";
import {
  AxleMessage,
  Citation,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
  type ToolResultPart,
} from "../../messages/message.js";
import type { ToolDefinition } from "../../tools/types.js";
import {
  type FileInfo,
  type FileResolver,
  type ResolvedFileSource,
  resolveFileSource,
} from "../../utils/file.js";
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
        content.push({
          type: "text",
          text: part.text,
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
            thinking: part.text ?? "",
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
        content.push({
          type: "server_tool_use",
          id: part.id,
          name: part.name,
          input: part.input ?? {},
        } as any);
        if (part.output != null) {
          content.push({
            type: "web_search_tool_result",
            tool_use_id: part.id,
            content: part.output,
          } as any);
        }
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

/**
 * Translate Axle's normalized `reasoning` boolean into Anthropic's thinking
 * field. Newer Claude 4.6+ adaptive-thinking models use effort instead of a
 * manual thinking token budget; older models keep the legacy budget form.
 * `false` and `undefined` produce no field (Anthropic defaults to off).
 * Users wanting precise control set `providerOptions.thinking` or
 * `providerOptions.output_config` directly, which spreads after this and
 * overrides.
 */
export function toAnthropicThinking(reasoning: boolean | undefined, model = "") {
  if (reasoning !== true) return {};
  if (supportsAdaptiveThinking(model)) {
    return {
      thinking: { type: "adaptive" as const },
      output_config: { effort: "high" as const },
    };
  }
  return { thinking: { type: "enabled" as const, budget_tokens: 8192 } };
}

function supportsAdaptiveThinking(model: string): boolean {
  const match = model.toLowerCase().match(/claude-(opus|sonnet)-(\d+)-(\d+)/);
  if (!match) return false;

  const [, family, majorText, minorText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;

  if (family === "opus") return major > 4 || (major === 4 && minor >= 6);
  if (family === "sonnet") return major > 4 || (major === 4 && minor >= 6);
  return false;
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
  web_search: "web_search_20250305",
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

export function convertToAxleContentParts(
  contentBlocks: Anthropic.Messages.ContentBlock[],
): Array<ContentPartText | ContentPartThinking | ContentPartToolCall> {
  const result: Array<ContentPartText | ContentPartThinking | ContentPartToolCall> = [];

  for (const block of contentBlocks) {
    if (block.type === "text") {
      const citations = block.citations?.map(normalizeAnthropicCitation);
      result.push({
        type: "text",
        text: block.text,
        ...(citations && citations.length > 0 ? { citations } : {}),
      });
    } else if (block.type === "thinking") {
      const isRedacted = block.thinking.length === 0 && Boolean(block.signature);
      result.push({
        type: "thinking",
        ...(block.thinking ? { text: block.thinking } : {}),
        redacted: isRedacted,
        continuity: { provider: "anthropic", signature: block.signature },
      });
    } else if (block.type === "redacted_thinking") {
      result.push({
        type: "thinking",
        redacted: true,
        continuity: { provider: "anthropic", redactedData: block.data },
      });
    } else if (block.type === "tool_use") {
      if (typeof block.input !== "object" || block.input === null || Array.isArray(block.input)) {
        throw new Error(
          `Invalid tool call input for ${block.name}: expected object, got ${typeof block.input}`,
        );
      }
      result.push({
        type: "tool-call",
        id: block.id,
        name: block.name,
        parameters: block.input as Record<string, unknown>,
      });
    }
  }

  return result;
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

export function convertStopReason(reason: string | null | undefined) {
  switch (reason) {
    case "max_tokens":
      return AxleStopReason.Length;
    case "end_turn":
      return AxleStopReason.Stop;
    case "stop_sequence":
      return AxleStopReason.Stop;
    case "tool_use":
      return AxleStopReason.FunctionCall;
    case "pause_turn":
    case "refusal":
    default:
      return AxleStopReason.Error;
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
