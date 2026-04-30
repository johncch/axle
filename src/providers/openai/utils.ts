import { ResponseInput } from "openai/resources/responses/responses.js";
import z from "zod";
import { AxleMessage, ContentPart } from "../../messages/message.js";
import { getTextContent } from "../../messages/utils.js";
import { ToolDefinition } from "../../tools/types.js";
import {
  type FileInfo,
  type FileResolver,
  type ResolvedFileSource,
  resolveFileSource,
} from "../../utils/file.js";

/* To Request */

export function prepareTools(tools?: Array<ToolDefinition>) {
  if (tools && tools.length > 0) {
    return tools.map((tool) => ({
      type: "function" as const,
      strict: true,
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.schema),
    }));
  }
  return undefined;
}

interface OpenAIConversionContext {
  model: string;
  fileResolver?: FileResolver;
  signal?: AbortSignal;
}

export async function convertAxleMessageToResponseInput(
  messages: AxleMessage[],
  context: OpenAIConversionContext = { model: "" },
): Promise<ResponseInput> {
  const converted = await Promise.all(messages.map((msg) => convertMessage(msg, context)));
  return converted.flat(1);
}

async function convertMessage(
  msg: AxleMessage,
  context: OpenAIConversionContext,
): Promise<ResponseInput[number] | ResponseInput> {
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
  context: OpenAIConversionContext,
) {
  return Promise.all(
    msg.content.map(async (r) => ({
      type: "function_call_output" as const,
      call_id: r.id,
      output:
        typeof r.content === "string"
          ? r.content
          : await Promise.all(
              r.content.map((part) =>
                part.type === "text"
                  ? Promise.resolve({ type: "input_text" as const, text: part.text })
                  : convertFilePart(part.file, context, "tool-result"),
              ),
            ),
    })),
  );
}

function convertAssistantMessage(msg: AxleMessage & { role: "assistant" }): ResponseInput {
  const result: ResponseInput = [];

  const textContent = getTextContent(msg.content);
  if (textContent) {
    result.push({
      role: msg.role,
      content: textContent,
    });
  }

  const toolCallParts = msg.content.filter((c) => c.type === "tool-call") as Array<
    ContentPart & { type: "tool-call" }
  >;
  for (const call of toolCallParts) {
    result.push({
      type: "function_call" as const,
      call_id: call.id,
      name: call.name,
      arguments: JSON.stringify(call.parameters),
    });
  }

  const internalToolParts = msg.content.filter((c) => c.type === "internal-tool");
  for (const part of internalToolParts) {
    if (part.output != null) {
      result.push(part.output as any);
    }
  }

  return result;
}

async function convertUserMessage(
  msg: AxleMessage & { role: "user" },
  context: OpenAIConversionContext,
) {
  if (typeof msg.content === "string") {
    return {
      role: msg.role,
      content: msg.content,
    };
  } else {
    const content = (
      await Promise.all(msg.content.map((part) => convertContentPart(part, context)))
    ).filter((item) => item !== null);

    return {
      role: msg.role,
      content,
    };
  }
}

async function convertContentPart(item: ContentPart, context: OpenAIConversionContext) {
  if (item.type === "text") {
    return {
      type: "input_text" as const,
      text: item.text,
    };
  }

  if (item.type === "file") {
    return convertFilePart(item.file, context, "user-message");
  }
  if (item.type === "thinking") {
    return null;
  }

  return null;
}

async function convertFilePart(
  file: FileInfo,
  context: OpenAIConversionContext,
  purpose: "user-message" | "tool-result",
) {
  if (file.kind === "image") {
    const resolved = await resolveFileSource(file, {
      provider: "openai",
      model: context.model,
      accepted: ["url", "base64"],
      purpose,
      resolver: context.fileResolver,
      signal: context.signal,
    });
    return {
      type: "input_image" as const,
      image_url: resolvedToImageUrl(resolved, file),
      detail: "auto" as const,
    };
  }

  if (file.kind === "document") {
    if (file.mimeType !== "application/pdf") {
      throw new Error(
        `OpenAI file inputs currently support PDF documents. Received ${file.mimeType}`,
      );
    }
    const resolved = await resolveFileSource(file, {
      provider: "openai",
      model: context.model,
      accepted: ["url", "base64"],
      purpose,
      resolver: context.fileResolver,
      signal: context.signal,
    });
    return resolvedToInputFile(resolved, file);
  }

  const resolved = await resolveFileSource(file, {
    provider: "openai",
    model: context.model,
    accepted: ["text", "url", "base64"],
    purpose,
    resolver: context.fileResolver,
    signal: context.signal,
  });

  if (resolved.type === "text") {
    return { type: "input_text" as const, text: resolved.content };
  }
  return resolvedToInputFile(resolved, file);
}

function resolvedToImageUrl(resolved: ResolvedFileSource, file: FileInfo): string {
  if (resolved.type === "url") return resolved.url;
  if (resolved.type === "base64") {
    return `data:${resolved.mimeType ?? file.mimeType};base64,${resolved.data}`;
  }
  throw new Error(`Unsupported OpenAI image source: ${resolved.type}`);
}

function resolvedToInputFile(resolved: ResolvedFileSource, file: FileInfo) {
  if (resolved.type === "url") {
    return {
      type: "input_file" as const,
      filename: resolved.name ?? file.name,
      file_url: resolved.url,
    };
  }
  if (resolved.type === "base64") {
    return {
      type: "input_file" as const,
      filename: resolved.name ?? file.name,
      file_data: `data:${resolved.mimeType ?? file.mimeType};base64,${resolved.data}`,
    };
  }
  throw new Error(`Unsupported OpenAI file source: ${resolved.type}`);
}
