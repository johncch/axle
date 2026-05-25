import z from "zod";
import type {
  AxleMessage,
  AxleToolCallResult,
  ContentPart,
  ToolResultPart,
} from "../messages/message.js";
import type { ProviderTool, ToolDefinition } from "../tools/types.js";
import type { ContextUsage } from "./types.js";

export interface ContextEstimateInput {
  system?: string;
  tools?: ToolDefinition[];
  providerTools?: ProviderTool[];
  mcpTools?: ToolDefinition[];
  messages: AxleMessage[];
  limit?: number;
}

export function estimateContextUsage(input: ContextEstimateInput): ContextUsage {
  const system = estimateTokens(input.system ?? "");
  const tools = estimateTools(input.tools);
  const mcpTools = estimateTools(input.mcpTools);
  const providerTools = estimateProviderTools(input.providerTools);
  const messages = input.messages.reduce((total, message) => total + estimateMessage(message), 0);
  const total = system + tools + mcpTools + providerTools + messages;

  return {
    total,
    system,
    tools,
    mcpTools,
    providerTools,
    messages,
    ...(input.limit !== undefined
      ? { limit: input.limit, free: Math.max(0, input.limit - total) }
      : {}),
  };
}

function estimateMessage(message: AxleMessage): number {
  switch (message.role) {
    case "user":
      return estimateContent(message.content);
    case "assistant":
      return estimateContent(message.content);
    case "tool":
      return message.content.reduce((total, result) => total + estimateToolResult(result), 0);
  }
}

function estimateContent(content: string | ContentPart[]): number {
  if (typeof content === "string") return estimateTokens(content);
  return content.reduce((total, part) => total + estimatePart(part), 0);
}

function estimatePart(part: ContentPart): number {
  switch (part.type) {
    case "text":
      return estimateTokens(part.text);
    case "thinking":
      return estimateTokens(part.summary ?? part.text);
    case "tool-call":
      return estimateTokens(part.name) + estimateJson(part.parameters);
    case "provider-tool":
      return estimateTokens(part.name) + estimateJson(part.input) + estimateJson(part.output);
    case "file":
      return estimateJson(part.file);
  }
}

function estimateToolResult(result: AxleToolCallResult): number {
  return estimateTokens(result.name) + estimateToolResultContent(result.content);
}

function estimateToolResultContent(content: string | ToolResultPart[]): number {
  if (typeof content === "string") return estimateTokens(content);
  return content.reduce((total, part) => {
    if (part.type === "text") return total + estimateTokens(part.text);
    return total + estimateJson(part.file);
  }, 0);
}

function estimateTools(tools?: ToolDefinition[]): number {
  const executableTools = tools?.map(toCountableTool) ?? [];

  if (executableTools.length === 0) return 0;
  return estimateJson({ tools: executableTools });
}

function estimateProviderTools(providerTools?: ProviderTool[]): number {
  if (!providerTools || providerTools.length === 0) return 0;
  return estimateJson({ providerTools });
}

function toCountableTool(tool: ToolDefinition): Record<string, unknown> {
  try {
    return {
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.schema),
    };
  } catch {
    return {
      name: tool.name,
      description: tool.description,
    };
  }
}

function estimateJson(value: unknown): number {
  if (value == null) return 0;
  return estimateTokens(JSON.stringify(value));
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3);
}
