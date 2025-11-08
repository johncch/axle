import { ResponseInput } from "openai/resources/responses/responses.js";
import z from "zod";
import { getTextContent } from "../../../messages/chat.js";
import { AxleMessage, ContentPart } from "../../../messages/types.js";
import { ToolDefinition } from "../../../tools/types.js";

/* To Request */

export function prepareTools(tools?: Array<ToolDefinition>) {
  if (tools && tools.length > 0) {
    return tools.map((tool) => {
      const jsonSchema = z.toJSONSchema(tool.schema);
      return {
        type: "function" as const,
        strict: true,
        name: tool.name,
        description: tool.description,
        parameters: jsonSchema,
      };
    });
  }
  return undefined;
}

export function convertAxleMessageToResponseInput(messages: AxleMessage[]): ResponseInput {
  return messages.map(convertMessage).flat(1);
}

function convertMessage(msg: AxleMessage): ResponseInput[number] | ResponseInput {
  switch (msg.role) {
    case "tool":
      return convertToolMessage(msg);
    case "assistant":
      return convertAssistantMessage(msg);
    default:
      return convertUserMessage(msg);
  }
}

function convertToolMessage(msg: AxleMessage & { role: "tool" }) {
  return msg.content.map((r) => ({
    type: "function_call_output" as const,
    call_id: r.id,
    output: r.content,
  }));
}

function convertAssistantMessage(msg: AxleMessage & { role: "assistant" }): ResponseInput {
  const result: ResponseInput = [];

  const thinkingParts = msg.content.filter((c) => c.type === "thinking") as Array<
    ContentPart & { type: "thinking" }
  >;
  if (thinkingParts.length > 0) {
    for (const thinking of thinkingParts) {
      result.push({
        type: "reasoning",
        id: `reasoning_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        summary: [
          {
            type: "summary_text" as const,
            text: thinking.text,
          },
        ],
      });
    }
  }

  const textContent = getTextContent(msg.content);
  const toolCallParts = msg.content.filter((c) => c.type === "tool-call") as Array<
    ContentPart & { type: "tool-call" }
  >;

  const toolCalls = toolCallParts.length > 0
    ? toolCallParts.map((call: any) => ({
        type: "function",
        id: call.id,
        function: {
          name: call.name,
          arguments: JSON.stringify(call.parameters),
        },
      }))
    : undefined;

  if (textContent || toolCalls) {
    result.push({
      role: msg.role,
      content: textContent,
      ...(toolCalls && { toolCalls }),
    });
  }

  return result;
}

function convertUserMessage(msg: AxleMessage & { role: "user" }) {
  if (typeof msg.content === "string") {
    return {
      role: msg.role,
      content: msg.content,
    };
  } else {
    const content = msg.content.map(convertContentPart).filter((item) => item !== null);

    return {
      role: msg.role,
      content,
    };
  }
}

function convertContentPart(item: ContentPart) {
  if (item.type === "text") {
    return {
      type: "input_text" as const,
      text: item.text,
    };
  }

  if (item.type === "file") {
    if (item.file.type === "image") {
      return {
        type: "input_image" as const,
        image_url: `data:${item.file.mimeType};base64,${item.file.base64}`,
        detail: "auto" as const,
      };
    }

    if (item.file.type === "document") {
      return {
        type: "input_file" as const,
        filename: item.file.path,
        file_data: `data:${item.file.mimeType};base64,${item.file.base64}`,
      };
    }
  }
  if (item.type === "thinking") {
    return null;
  }

  return null;
}
