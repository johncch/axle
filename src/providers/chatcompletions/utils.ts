import z from "zod";
import { AxleMessage, ContentPart } from "../../messages/message.js";
import { ToolDefinition } from "../../tools/types.js";
import {
  type FileInfo,
  type FileResolver,
  type ResolvedFileSource,
  resolveFileSource,
} from "../../utils/file.js";
import { AxleStopReason } from "../types.js";
import { ChatCompletionContentPart, ChatCompletionMessage, ChatCompletionTool } from "./types.js";

interface ChatCompletionsConversionContext {
  model: string;
  fileResolver?: FileResolver;
  signal?: AbortSignal;
}

export async function convertAxleMessages(
  messages: AxleMessage[],
  system?: string,
  context: ChatCompletionsConversionContext = { model: "" },
): Promise<ChatCompletionMessage[]> {
  const converted = (await Promise.all(messages.map((msg) => convertMessage(msg, context)))).flat(
    1,
  );

  if (system) {
    return [{ role: "system", content: system }, ...converted];
  }

  return converted;
}

/**
 * Translate Axle's normalized `reasoning` boolean into Chat Completions
 * `reasoning_effort`. `true` → "high"; `false` → "minimal" (suppresses
 * thinking on reasoning models that default to it); `undefined` → omit.
 * Users who need a specific tier set `options.reasoning_effort` directly,
 * which overrides this.
 */
export function toReasoningEffort(reasoning: boolean | undefined) {
  if (reasoning === true) return { reasoning_effort: "high" as const };
  if (reasoning === false) return { reasoning_effort: "minimal" as const };
  return {};
}

export function convertTools(tools?: Array<ToolDefinition>): ChatCompletionTool[] | undefined {
  if (tools && tools.length > 0) {
    return tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: z.toJSONSchema(tool.schema),
      },
    }));
  }
  return undefined;
}

export function convertFinishReason(reason: string | null): AxleStopReason {
  switch (reason) {
    case "stop":
      return AxleStopReason.Stop;
    case "length":
      return AxleStopReason.Length;
    case "tool_calls":
    case "function_call":
      return AxleStopReason.FunctionCall;
    case "content_filter":
      return AxleStopReason.Error;
    default:
      return AxleStopReason.Stop;
  }
}

async function convertMessage(
  msg: AxleMessage,
  context: ChatCompletionsConversionContext,
): Promise<ChatCompletionMessage | ChatCompletionMessage[]> {
  switch (msg.role) {
    case "tool":
      return convertToolMessage(msg, context);
    case "assistant":
      return convertAssistantMessage(msg);
    default:
      return convertUserMessage(msg, context);
  }
}

async function convertToolMessage(
  msg: AxleMessage & { role: "tool" },
  context: ChatCompletionsConversionContext,
): Promise<ChatCompletionMessage[]> {
  return Promise.all(
    msg.content.map(async (r) => ({
      role: "tool" as const,
      content:
        typeof r.content === "string"
          ? r.content
          : await convertToolResultContent(r.content, context),
      tool_call_id: r.id,
    })),
  );
}

function convertAssistantMessage(msg: AxleMessage & { role: "assistant" }): ChatCompletionMessage {
  const toolCallParts = msg.content.filter((c) => c.type === "tool-call");
  const textParts = msg.content.filter((c) => c.type === "text");

  const toolCalls =
    toolCallParts.length > 0
      ? toolCallParts.map((call: any) => ({
          type: "function" as const,
          id: call.id,
          function: {
            name: call.name,
            arguments: JSON.stringify(call.parameters),
          },
        }))
      : undefined;

  return {
    role: "assistant",
    content: textParts.map((c: any) => c.text).join(""),
    ...(toolCalls && { tool_calls: toolCalls }),
  };
}

async function convertUserMessage(
  msg: AxleMessage & { role: "user" },
  context: ChatCompletionsConversionContext,
): Promise<ChatCompletionMessage> {
  if (typeof msg.content === "string") {
    return { role: "user", content: msg.content };
  }

  const parts = (
    await Promise.all(msg.content.map((part) => convertContentPart(part, context)))
  ).filter((p) => p !== null);

  // If all parts are text, join them into a single string
  if (parts.every((p) => p.type === "text")) {
    return {
      role: "user",
      content: parts.map((p) => p.text!).join(""),
    };
  }

  return { role: "user", content: parts };
}

async function convertContentPart(
  item: ContentPart,
  context: ChatCompletionsConversionContext,
): Promise<ChatCompletionContentPart | null> {
  if (item.type === "text") {
    return {
      type: "text" as const,
      text: item.text,
    };
  }

  if (item.type === "file") {
    return convertFilePart(item.file, context, "user-message");
  }

  return null;
}

async function convertToolResultContent(
  parts: Array<{ type: "text"; text: string } | { type: "file"; file: FileInfo }>,
  context: ChatCompletionsConversionContext,
): Promise<string> {
  const output: string[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      output.push(part.text);
      continue;
    }
    if (part.file.kind === "text") {
      const resolved = await resolveFileSource(part.file, {
        provider: "chatcompletions",
        model: context.model,
        accepted: ["text"],
        purpose: "tool-result",
        resolver: context.fileResolver,
        signal: context.signal,
      });
      if (resolved.type !== "text") {
        throw new Error(`Unsupported ChatCompletions text source: ${resolved.type}`);
      }
      output.push(
        formatTextFileContent(part.file, resolved.content, resolved.name, resolved.mimeType),
      );
      continue;
    }
    throw new Error("ChatCompletions tool results do not support file parts other than text");
  }
  return output.join("\n");
}

async function convertFilePart(
  file: FileInfo,
  context: ChatCompletionsConversionContext,
  purpose: "user-message" | "tool-result",
): Promise<ChatCompletionContentPart> {
  if (file.kind === "text") {
    const resolved = await resolveFileSource(file, {
      provider: "chatcompletions",
      model: context.model,
      accepted: ["text"],
      purpose,
      resolver: context.fileResolver,
      signal: context.signal,
    });
    if (resolved.type !== "text") {
      throw new Error(`Unsupported ChatCompletions text source: ${resolved.type}`);
    }
    return {
      type: "text",
      text: formatTextFileContent(file, resolved.content, resolved.name, resolved.mimeType),
    };
  }

  if (file.kind === "document") {
    if (file.mimeType !== "application/pdf") {
      throw new Error(
        `ChatCompletions document file inputs currently support PDF only. Received ${file.mimeType}`,
      );
    }
    const resolved = await resolveFileSource(file, {
      provider: "chatcompletions",
      model: context.model,
      accepted: ["url", "base64"],
      purpose,
      resolver: context.fileResolver,
      signal: context.signal,
    });

    return {
      type: "file",
      file: {
        filename: resolved.name ?? file.name,
        file_data: resolvedToFileData(resolved, file),
      },
    };
  }

  const resolved = await resolveFileSource(file, {
    provider: "chatcompletions",
    model: context.model,
    accepted: ["url", "base64"],
    purpose,
    resolver: context.fileResolver,
    signal: context.signal,
  });

  return {
    type: "image_url",
    image_url: { url: resolvedToImageUrl(resolved, file) },
  };
}

function resolvedToImageUrl(resolved: ResolvedFileSource, file: FileInfo): string {
  if (resolved.type === "url") return resolved.url;
  if (resolved.type === "base64") {
    return `data:${resolved.mimeType ?? file.mimeType};base64,${resolved.data}`;
  }
  throw new Error(`Unsupported ChatCompletions image source: ${resolved.type}`);
}

function resolvedToFileData(resolved: ResolvedFileSource, file: FileInfo): string {
  if (resolved.type === "url") return resolved.url;
  if (resolved.type === "base64") {
    return `data:${resolved.mimeType ?? file.mimeType};base64,${resolved.data}`;
  }
  throw new Error(`Unsupported ChatCompletions file source: ${resolved.type}`);
}

function formatTextFileContent(
  file: FileInfo,
  content: string,
  name?: string,
  mimeType?: string,
): string {
  return `File: ${name ?? file.name}\nMIME type: ${mimeType ?? file.mimeType}\n\n${content}`;
}
