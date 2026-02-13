import Anthropic from "@anthropic-ai/sdk";
import z from "zod";
import {
  AxleMessage,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
} from "../../messages/message.js";
import { ToolDefinition } from "../../tools/types.js";
import { AxleStopReason } from "../types.js";

export function convertToProviderMessages(
  messages: Array<AxleMessage>,
): Array<Anthropic.MessageParam> {
  return messages.map((msg) => {
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
          } else {
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
        content: msg.content.map((r) => ({
          type: "tool_result",
          tool_use_id: r.id,
          content: r.content,
        })) satisfies Array<Anthropic.ToolResultBlockParam>,
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
          if (part.file.type === "image") {
            content.push({
              type: "image",
              source: {
                type: "base64",
                media_type: part.file.mimeType as
                  | "image/jpeg"
                  | "image/png"
                  | "image/gif"
                  | "image/webp",
                data: part.file.base64,
              },
            } satisfies Anthropic.ImageBlockParam);
          } else if (part.file.type === "document" && part.file.mimeType === "application/pdf") {
            content.push({
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: part.file.base64,
              },
            } satisfies Anthropic.DocumentBlockParam);
          }
          // Skip unsupported file types (non-PDF documents, videos, etc.)
        }
      }

      return {
        role: "user",
        content,
      } satisfies Anthropic.MessageParam;
    }
  });
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

export function convertStopReason(reason: string) {
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
