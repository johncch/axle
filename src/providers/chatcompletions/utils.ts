import z from "zod";
import { AxleMessage, ContentPart } from "../../messages/message.js";
import { ToolDefinition } from "../../tools/types.js";
import { AxleStopReason } from "../types.js";
import { ChatCompletionContentPart, ChatCompletionMessage, ChatCompletionTool } from "./types.js";

export function convertAxleMessages(
  messages: AxleMessage[],
  system?: string,
): ChatCompletionMessage[] {
  const converted = messages.map(convertMessage).flat(1);

  if (system) {
    return [{ role: "system", content: system }, ...converted];
  }

  return converted;
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

function convertMessage(msg: AxleMessage): ChatCompletionMessage | ChatCompletionMessage[] {
  switch (msg.role) {
    case "tool":
      return convertToolMessage(msg);
    case "assistant":
      return convertAssistantMessage(msg);
    default:
      return convertUserMessage(msg);
  }
}

function convertToolMessage(msg: AxleMessage & { role: "tool" }): ChatCompletionMessage[] {
  return msg.content.map((r) => ({
    role: "tool" as const,
    content:
      typeof r.content === "string"
        ? r.content
        : r.content
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n"),
    tool_call_id: r.id,
  }));
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

function convertUserMessage(msg: AxleMessage & { role: "user" }): ChatCompletionMessage {
  if (typeof msg.content === "string") {
    return { role: "user", content: msg.content };
  }

  const parts = msg.content.map(convertContentPart).filter((p) => p !== null);

  // If all parts are text, join them into a single string
  if (parts.every((p) => p.type === "text")) {
    return {
      role: "user",
      content: parts.map((p) => p.text!).join(""),
    };
  }

  return { role: "user", content: parts };
}

function convertContentPart(item: ContentPart): ChatCompletionContentPart | null {
  if (item.type === "text") {
    return {
      type: "text" as const,
      text: item.text,
    };
  }

  if (item.type === "file" && item.file.type === "image") {
    return {
      type: "image_url" as const,
      image_url: {
        url: `data:${item.file.mimeType};base64,${item.file.base64}`,
      },
    };
  }

  return null;
}
