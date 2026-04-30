import Anthropic from "@anthropic-ai/sdk";
import z from "zod";
import {
  AxleMessage,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
  type ToolResultPart,
} from "../../messages/message.js";
import { ToolDefinition } from "../../tools/types.js";
import {
  type FileInfo,
  type FileResolver,
  type ResolvedFileSource,
  resolveFileSource,
} from "../../utils/file.js";
import { AxleStopReason } from "../types.js";

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
        if (part.redacted) {
          content.push({
            type: "redacted_thinking",
            data: part.text,
          });
        } else if (part.signature) {
          content.push({
            type: "thinking",
            thinking: part.text,
            signature: part.signature,
          });
        }
      } else if (part.type === "tool-call") {
        content.push({
          type: "tool_use",
          id: part.id,
          name: part.name,
          input: part.parameters,
        } satisfies Anthropic.ToolUseBlockParam);
      } else if (part.type === "internal-tool") {
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
 * field. `true` enables extended thinking with a sensible default budget;
 * `false` and `undefined` produce no field (Anthropic defaults to off).
 * Users wanting precise control set `options.thinking` directly, which spreads
 * after this and overrides.
 */
export function toAnthropicThinking(reasoning: boolean | undefined) {
  if (reasoning === true) {
    return { thinking: { type: "enabled" as const, budget_tokens: 8192 } };
  }
  return {};
}

export function convertToProviderTools(
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

export function convertToAxleContentParts(
  contentBlocks: Anthropic.Messages.ContentBlock[],
): Array<ContentPartText | ContentPartThinking | ContentPartToolCall> {
  const result: Array<ContentPartText | ContentPartThinking | ContentPartToolCall> = [];

  for (const block of contentBlocks) {
    if (block.type === "text") {
      result.push({
        type: "text",
        text: block.text,
      });
    } else if (block.type === "thinking") {
      result.push({
        type: "thinking",
        text: (block as any).text || "",
        redacted: false,
      });
    } else if (block.type === "redacted_thinking") {
      result.push({
        type: "thinking",
        text: (block as any).text || "",
        redacted: true,
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
