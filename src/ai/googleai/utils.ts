import { Content, FinishReason, GenerateContentConfig } from "@google/genai";
import z from "zod";
import { AxleMessage, ContentPart } from "../../messages/types.js";
import { ToolDefinition } from "../../tools/index.js";
import { AxleStopReason } from "../types.js";

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

export function convertAxleMessagesToGoogleAI(messages: AxleMessage[]): Content[] {
  return messages.map(convertMessage).filter((msg): msg is Content => msg !== undefined);
}

function convertMessage(msg: AxleMessage): Content | undefined {
  switch (msg.role) {
    case "tool":
      return convertToolMessage(msg);
    case "assistant":
      return convertAssistantMessage(msg);
    case "user":
      return convertUserMessage(msg);
  }
}

function convertToolMessage(msg: AxleMessage & { role: "tool" }): Content {
  return {
    role: "user",
    parts: msg.content.map((item) => ({
      functionResponse: {
        id: item.id ?? undefined,
        name: item.name,
        response: {
          output: item.content,
        },
      },
    })),
  };
}

function convertAssistantMessage(msg: AxleMessage & { role: "assistant" }): Content {
  const parts: any[] = [];

  const textParts = msg.content.filter((c) => c.type === "text");
  if (textParts.length > 0) {
    const text = textParts.map((c: any) => c.text).join("");
    if (text) {
      parts.push({ text });
    }
  }

  const toolCallParts = msg.content.filter((c) => c.type === "tool-call");
  if (toolCallParts.length > 0) {
    parts.push(
      ...toolCallParts.map((item: any) => {
        return {
          functionCall: {
            id: item.id ?? undefined,
            name: item.name,
            args: item.parameters,
          },
        };
      }),
    );
  }

  return {
    role: "assistant",
    parts,
  };
}

function convertUserMessage(msg: AxleMessage & { role: "user" }): Content {
  if (typeof msg.content === "string") {
    return { role: "user", parts: [{ text: msg.content }] };
  } else {
    const parts = msg.content.map(convertContentPart).filter((item) => item !== null);

    return {
      role: "user",
      parts,
    };
  }
}

function convertContentPart(item: ContentPart): any | null {
  if (item.type === "text" || item.type === "instructions") {
    return {
      text: item.type === "text" ? item.text : item.instructions,
    };
  }

  if (item.type === "file") {
    if (item.file.type === "image" || item.file.type === "document") {
      return {
        inlineData: {
          mimeType: item.file.mimeType,
          data: item.file.base64,
        },
      };
    }
  }

  // TODO: thinking, etc.
  return null;
}

/* To Response */

export function convertStopReason(reason: FinishReason): [boolean, AxleStopReason] {
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
}
