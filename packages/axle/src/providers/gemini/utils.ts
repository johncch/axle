import {
  Content,
  FinishReason,
  FunctionCallingConfigMode,
  GenerateContentConfig,
} from "@google/genai";
import z from "zod";
import { AxleMessage, ContentPart } from "../../messages/message.js";
import { Models } from "../../models.js";
import type { ToolDefinition } from "../../tools/index.js";
import { LEGACY_REASONING_BUDGETS, resolveReasoning, type ReasoningSetting } from "../reasoning.js";
import {
  type FileInfo,
  type FileResolver,
  type ResolvedFileSource,
  resolveFileSource,
} from "../../utils/file.js";
import { AxleStopReason, type ResolvedProviderTool, ToolChoice } from "../types.js";

/* To Request */

export function prepareConfig(
  tools?: Array<ToolDefinition>,
  system?: string,
  options?: Record<string, any>,
): GenerateContentConfig {
  const config: GenerateContentConfig = {};

  if (system) {
    config.systemInstruction = system;
  }

  if (tools && tools.length > 0) {
    config.tools = tools.map((tool) => {
      return {
        functionDeclarations: [
          {
            name: tool.name,
            description: tool.description,
            parametersJsonSchema: z.toJSONSchema(tool.schema),
          },
        ],
      };
    });
  }

  // Merge options into config
  if (options) {
    Object.assign(config, options);
  }

  return config;
}

const PROVIDER_TOOL_MAP: Record<string, string> = {
  web_search: "googleSearch",
  code_execution: "codeExecution",
};

export function resolveGeminiProviderToolName(name: string): string {
  return PROVIDER_TOOL_MAP[name] ?? name;
}

export function addGeminiProviderTools(
  config: GenerateContentConfig,
  providerTools?: ResolvedProviderTool[],
) {
  if (!providerTools || providerTools.length === 0) return;
  if (!config.tools) config.tools = [];
  for (const tool of providerTools) {
    const key = tool.nativeName ?? resolveGeminiProviderToolName(tool.name);
    config.tools.push({ [key]: tool.config ?? {} } as any);
  }
}

export function toGeminiToolConfig(
  choice: ToolChoice | undefined,
  parallelToolCalls: boolean | undefined,
  tools?: Array<ToolDefinition>,
  providerTools?: Array<ResolvedProviderTool>,
) {
  if (parallelToolCalls === false) {
    throw new Error("Gemini does not support disabling parallel tool calls");
  }
  if (choice === undefined) return {};
  if (choice === "auto") {
    return { toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } } };
  }
  if (choice === "none") {
    return { toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } } };
  }
  if (choice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error("Gemini requires function tools for required tool choice");
    }
    return { toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } } };
  }

  if (tools?.some((tool) => tool.name === choice.name)) {
    return {
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
          allowedFunctionNames: [choice.name],
        },
      },
    };
  }

  if (providerTools?.some((tool) => tool.name === choice.name)) {
    throw new Error(`Gemini does not support provider tool choice: ${choice.name}`);
  }

  throw new Error(`Tool choice references an unavailable tool: ${choice.name}`);
}

export function toGeminiThinkingConfig(reasoning: ReasoningSetting | undefined, model = "") {
  const request = resolveReasoning(reasoning);
  if (request === "default") return {};
  if (request === "off") return { thinkingConfig: { thinkingBudget: 0 } };
  if (usesGeminiThinkingBudget(model)) {
    return {
      thinkingConfig: {
        thinkingBudget: LEGACY_REASONING_BUDGETS[request.effort],
        includeThoughts: request.display === "visible",
      },
    };
  }
  return {
    thinkingConfig: {
      thinkingLevel: request.effort,
      includeThoughts: request.display === "visible",
    },
  };
}

/**
 * Every Gemini ID that only accepts `thinkingBudget`. Anything else,
 * including aliases and unknown IDs, takes the `thinkingLevel` route.
 */
export const GEMINI_THINKING_BUDGET_MODELS: ReadonlySet<string> = new Set([
  Models.Google.GEMINI_2_5_FLASH,
  Models.Google.GEMINI_2_5_FLASH_LITE,
  Models.Google.GEMINI_2_5_PRO,
]);

function usesGeminiThinkingBudget(model: string): boolean {
  return GEMINI_THINKING_BUDGET_MODELS.has(`google/${model.toLowerCase()}`);
}

interface GeminiConversionContext {
  model: string;
  fileResolver?: FileResolver;
  signal?: AbortSignal;
}

export async function convertAxleMessagesToGemini(
  messages: AxleMessage[],
  context: GeminiConversionContext = { model: "" },
): Promise<Content[]> {
  const converted = await Promise.all(messages.map((msg) => convertMessage(msg, context)));
  return converted.filter((msg): msg is Content => msg !== undefined);
}

async function convertMessage(
  msg: AxleMessage,
  context: GeminiConversionContext,
): Promise<Content | undefined> {
  switch (msg.role) {
    case "tool":
      return convertToolMessage(msg, context);
    case "assistant":
      return convertAssistantMessage(msg);
    case "user":
      return convertUserMessage(msg, context);
  }
}

async function convertToolMessage(
  msg: AxleMessage & { role: "tool" },
  context: GeminiConversionContext,
): Promise<Content> {
  const groupedParts = await Promise.all(
    msg.content.map(async (item) => {
      const textOutput =
        typeof item.content === "string"
          ? item.content
          : item.content
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("\n");

      const responsePart = {
        functionResponse: {
          id: item.id ?? undefined,
          name: item.name,
          response: { output: textOutput },
        },
      };

      if (typeof item.content === "string") return [responsePart];

      const fileParts = await Promise.all(
        item.content
          .filter((p) => p.type === "file")
          .map((p) => convertFilePart(p.file, context, "tool-result")),
      );

      return [responsePart, ...fileParts];
    }),
  );

  return {
    role: "user",
    parts: groupedParts.flat(1),
  };
}

function convertAssistantMessage(msg: AxleMessage & { role: "assistant" }): Content {
  const parts: any[] = [];

  for (const item of msg.content) {
    if (item.type === "thinking") {
      if (item.continuity?.provider !== "gemini") continue;
      parts.push({
        ...(item.summary ? { thought: true, text: item.summary } : { text: "" }),
        thoughtSignature: item.continuity.thoughtSignature,
      });
    } else if (item.type === "text") {
      if (!item.text) continue;
      const part: Record<string, unknown> = { text: item.text };
      if (item.providerMetadata?.thoughtSignature) {
        part.thoughtSignature = item.providerMetadata.thoughtSignature;
      }
      parts.push(part);
    } else if (item.type === "tool-call") {
      const part: Record<string, unknown> = {
        functionCall: {
          id: item.id ?? undefined,
          name: item.name,
          args: item.parameters,
        },
      };
      if (item.providerMetadata?.thoughtSignature) {
        part.thoughtSignature = item.providerMetadata.thoughtSignature;
      }
      parts.push(part);
    }
  }

  return {
    role: "model",
    parts,
  };
}

async function convertUserMessage(
  msg: AxleMessage & { role: "user" },
  context: GeminiConversionContext,
): Promise<Content> {
  if (typeof msg.content === "string") {
    return { role: "user", parts: [{ text: msg.content }] };
  } else {
    const parts = (
      await Promise.all(msg.content.map((part) => convertContentPart(part, context)))
    ).filter((item) => item !== null);

    return {
      role: "user",
      parts,
    };
  }
}

async function convertContentPart(
  item: ContentPart,
  context: GeminiConversionContext,
): Promise<any | null> {
  if (item.type === "text") {
    return {
      text: item.text,
    };
  }

  if (item.type === "file") {
    return convertFilePart(item.file, context, "user-message");
  }

  // TODO: thinking, etc.
  return null;
}

async function convertFilePart(
  file: FileInfo,
  context: GeminiConversionContext,
  purpose: "user-message" | "tool-result",
): Promise<any> {
  if (file.kind === "text") {
    const resolved = await resolveFileSource(file, {
      provider: "gemini",
      model: context.model,
      accepted: ["text"],
      purpose,
      resolver: context.fileResolver,
      signal: context.signal,
    });
    if (resolved.type !== "text") {
      throw new Error(`Unsupported Gemini text source: ${resolved.type}`);
    }
    return {
      text: formatTextFileContent(file, resolved.content, resolved.name, resolved.mimeType),
    };
  }

  if (file.kind === "document" && file.mimeType !== "application/pdf") {
    throw new Error(`Gemini document file support is limited to PDFs. Received ${file.mimeType}`);
  }

  const resolved = await resolveFileSource(file, {
    provider: "gemini",
    model: context.model,
    accepted: ["gemini-file-uri", "url", "base64"],
    purpose,
    resolver: context.fileResolver,
    signal: context.signal,
  });
  return resolvedToGeminiPart(resolved, file);
}

function resolvedToGeminiPart(resolved: ResolvedFileSource, file: FileInfo): any {
  if (resolved.type === "base64") {
    return {
      inlineData: {
        mimeType: resolved.mimeType ?? file.mimeType,
        data: resolved.data,
      },
    };
  }
  if (resolved.type === "url") {
    return {
      fileData: {
        mimeType: resolved.mimeType ?? file.mimeType,
        fileUri: resolved.url,
      },
    };
  }
  if (resolved.type === "gemini-file-uri") {
    return {
      fileData: {
        mimeType: resolved.mimeType ?? file.mimeType,
        fileUri: resolved.uri,
      },
    };
  }
  throw new Error(`Unsupported Gemini file source: ${resolved.type}`);
}

function formatTextFileContent(
  file: FileInfo,
  content: string,
  name?: string,
  mimeType?: string,
): string {
  return `File: ${name ?? file.name}\nMIME type: ${mimeType ?? file.mimeType}\n\n${content}`;
}

/* To Response */

export function convertStopReason(reason: FinishReason | undefined): [boolean, AxleStopReason] {
  switch (reason) {
    case FinishReason.STOP:
      return [true, AxleStopReason.Stop];
    case FinishReason.MAX_TOKENS:
      return [true, AxleStopReason.Length];
    case FinishReason.FINISH_REASON_UNSPECIFIED:
    case FinishReason.SAFETY:
    case FinishReason.RECITATION:
    case FinishReason.LANGUAGE:
    case FinishReason.OTHER:
    case FinishReason.BLOCKLIST:
    case FinishReason.PROHIBITED_CONTENT:
    case FinishReason.SPII:
    case FinishReason.MALFORMED_FUNCTION_CALL:
    case FinishReason.IMAGE_SAFETY:
      return [false, AxleStopReason.Error];
  }

  return [false, AxleStopReason.Error];
}
