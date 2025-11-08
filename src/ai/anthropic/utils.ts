import Anthropic from "@anthropic-ai/sdk";
import {
  ContentBlockParam,
  DocumentBlockParam,
  ImageBlockParam,
  MessageParam,
  Messages,
  TextBlockParam,
  ToolResultBlockParam,
  ToolUseBlockParam,
} from "@anthropic-ai/sdk/resources";
import z from "zod";
import { Chat, getDocuments, getImages, getTextAndInstructions } from "../../messages/chat.js";
import {
  AxleMessage,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
} from "../../messages/types.js";
import { ToolDefinition } from "../../tools/types.js";
import { AxleStopReason } from "../types.js";

export function prepareRequest(chat: Chat) {
  const messages = convertToProviderMessages(chat.messages);

  const tools = chat.tools.map((t) => {
    const schema = z.toJSONSchema(t.schema);
    if (!isObjectSchema(schema)) {
      throw new Error(`Schema for tool ${t.name} must be an object type`);
    }
    return {
      name: t.name,
      description: t.description,
      input_schema: schema,
    };
  });

  return {
    system: chat.system,
    messages: messages,
    tools: tools,
  };
}

export function convertToProviderMessages(messages: Array<AxleMessage>): Array<MessageParam> {
  return messages.map((msg) => {
    if (msg.role === "assistant") {
      const content: Array<ContentBlockParam> = [];
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
          } satisfies ToolUseBlockParam);
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
        })) satisfies Array<ToolResultBlockParam>,
      } satisfies MessageParam;
    }

    if (typeof msg.content === "string") {
      return {
        role: "user",
        content: msg.content,
      } satisfies MessageParam;
    } else {
      const content: Array<TextBlockParam | ImageBlockParam | DocumentBlockParam> = [];

      const text = getTextAndInstructions(msg.content);
      if (text) {
        content.push({
          type: "text",
          text,
        } satisfies TextBlockParam);
      }

      const images = getImages(msg.content);
      if (images.length > 0) {
        content.push(
          ...images.map(
            (img) =>
              ({
                type: "image" as const,
                source: {
                  type: "base64",
                  media_type: img.mimeType as
                    | "image/jpeg"
                    | "image/png"
                    | "image/gif"
                    | "image/webp",
                  data: img.base64,
                },
              }) satisfies ImageBlockParam,
          ),
        );
      }

      const documents = getDocuments(msg.content);
      if (documents.length > 0) {
        content.push(
          ...documents
            .filter((doc) => doc.mimeType === "application/pdf")
            .map(
              (doc) =>
                ({
                  type: "document" as const,
                  source: {
                    type: "base64",
                    media_type: "application/pdf",
                    data: doc.base64,
                  },
                }) satisfies DocumentBlockParam,
            ),
        );
      }

      return {
        role: "user",
        content,
      } satisfies MessageParam;
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
      if (
        typeof block.input !== "object" ||
        block.input === null ||
        Array.isArray(block.input)
      ) {
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
