import {
  ChatCompletion,
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources";
import z from "zod";
import { AxleMessage, ContentPart } from "../../../messages/types.js";
import { ToolDefinition } from "../../../tools/index.js";
import { AxleStopReason } from "../../types.js";

/* To Request */

export function toModelTools(
  tools: Array<ToolDefinition> | undefined,
): Array<ChatCompletionTool> | undefined {
  if (tools && tools.length > 0) {
    return tools.map((tool) => {
      const jsonSchema = z.toJSONSchema(tool.schema);
      return {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: jsonSchema,
        },
      };
    });
  }
  return undefined;
}

export function convertAxleMessagesToChatCompletion(
  messages: AxleMessage[],
): ChatCompletionMessageParam[] {
  return messages.map(convertMessage).flat(1);
}

function convertMessage(msg: AxleMessage) {
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
    role: "tool" as const,
    tool_call_id: r.id,
    content: r.content,
  }));
}

function convertAssistantMessage(msg: AxleMessage & { role: "assistant" }) {
  const toolCalls = msg.toolCalls?.map((call) => {
    const id = call.id;
    return {
      type: "function",
      function: {
        name: call.name,
        arguments:
          typeof call.parameters === "string" ? call.parameters : JSON.stringify(call.parameters),
      },
      ...(id && { id }),
    };
  });
  return {
    role: msg.role,
    content: msg.content.map((c) => c.text).join(""),
    ...(toolCalls && { toolCalls }),
  };
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

function convertContentPart(item: ContentPart): ChatCompletionContentPart | null {
  if (item.type === "text" || item.type === "instructions") {
    return {
      type: "text" as const,
      text: item.type === "text" ? item.text : item.instructions,
    };
  }

  if (item.type === "file") {
    if (item.file.type === "image") {
      return {
        type: "image_url" as const,
        image_url: {
          url: `data:${item.file.mimeType};base64,${item.file.base64}`,
        },
      };
    }

    if (item.file.type === "document") {
      return {
        type: "file" as const,
        file: {
          filename: item.file.name,
          file_data: `data:${item.file.mimeType};base64,${item.file.base64}`,
        },
      };
    }
  }

  // TODO: thinking, etc.
  return null;
}

/* To Response */

export function convertStopReason(reason: ChatCompletion.Choice["finish_reason"]) {
  switch (reason) {
    case "length":
      return AxleStopReason.Length;
    case "stop":
      return AxleStopReason.Stop;
    case "tool_calls":
      return AxleStopReason.FunctionCall;
    default:
      return AxleStopReason.Error;
  }
}
