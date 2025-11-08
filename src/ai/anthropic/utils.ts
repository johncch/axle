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
      content.push(...converToProviderContentParts(msg.content));
      if (msg.toolCalls) {
        content.push(
          ...msg.toolCalls.map(
            (call) =>
              ({
                type: "tool_use",
                id: call.id,
                name: call.name,
                input: call.parameters,
              }) satisfies ToolUseBlockParam,
          ),
        );
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
): Array<ContentPartText | ContentPartThinking> {
  const result: Array<ContentPartText | ContentPartThinking> = [];

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
    }
    // Note: tool_use blocks are handled separately as toolCalls in AxleAssistantMessage
    // TODO - implement
  }

  return result;
}

export function converToProviderContentParts(
  parts: Array<ContentPartText | ContentPartThinking>,
): Anthropic.Messages.ContentBlockParam[] {
  const result: Anthropic.Messages.ContentBlockParam[] = [];

  for (const part of parts) {
    if (part.type === "text") {
      result.push({
        type: "text",
        text: part.text,
      });
    } else if (part.type === "thinking") {
      if (part.redacted) {
        result.push({
          type: "redacted_thinking",
          data: part.text,
        });
      } else {
        result.push({
          type: "thinking",
          thinking: part.text,
          signature: part.signature,
        });
      }
    }
  }

  return result;
}

export function convertToAxleToolCalls(
  parts: Array<Messages.ContentBlock>,
): Array<ContentPartToolCall> {
  return parts
    .slice(1)
    .map((toolUse) => {
      if (toolUse.type === "tool_use") {
        // Validate that input is an object
        if (
          typeof toolUse.input !== "object" ||
          toolUse.input === null ||
          Array.isArray(toolUse.input)
        ) {
          throw new Error(
            `Invalid tool call input for ${toolUse.name}: expected object, got ${typeof toolUse.input}`,
          );
        }
        return {
          type: "tool-call" as const,
          id: toolUse.id,
          name: toolUse.name,
          parameters: toolUse.input as Record<string, unknown>,
        };
      }
    })
    .filter((v) => v);
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
