import z from "zod";
import { AxleMessage, ContentPart } from "../../messages/types.js";
import { ToolDefinition } from "../../tools/types.js";
import { OllamaMessage } from "./types.js";

export function convertAxleMessagesToOllama(messages: AxleMessage[]): OllamaMessage[] {
  return messages.map(convertMessage).flat(1);
}

export function convertToolDefToOllama(tools: Array<ToolDefinition>) {
  return tools && tools.length > 0
    ? tools.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: z.toJSONSchema(tool.schema),
        },
      }))
    : undefined;
}

function convertMessage(msg: AxleMessage): OllamaMessage | OllamaMessage[] {
  switch (msg.role) {
    case "tool":
      return convertToolMessage(msg);
    case "assistant":
      return convertAssistantMessage(msg);
    default:
      return convertUserMessage(msg);
  }
}

function convertToolMessage(msg: AxleMessage & { role: "tool" }): OllamaMessage[] {
  return msg.content.map((r) => ({
    role: "tool" as const,
    tool_call_id: r.id,
    content: r.content,
  }));
}

function convertAssistantMessage(msg: AxleMessage & { role: "assistant" }): OllamaMessage {
  const toolCalls = msg.toolCalls?.map((call) => {
    const id = call.id;
    return {
      type: "function",
      function: {
        name: call.name,
        arguments: call.arguments,
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

function convertUserMessage(msg: AxleMessage & { role: "user" }): OllamaMessage {
  if (typeof msg.content === "string") {
    return {
      role: msg.role,
      content: msg.content,
    };
  } else {
    const textParts: string[] = [];
    const images: string[] = [];

    for (const part of msg.content) {
      const result = convertContentPart(part);
      if (result.text !== null) {
        textParts.push(result.text);
      }
      if (result.image !== null) {
        images.push(result.image);
      }
    }

    return {
      role: msg.role,
      content: textParts.join(""),
      ...(images.length > 0 && { images }),
    };
  }
}

function convertContentPart(item: ContentPart): { text: string | null; image: string | null } {
  if (item.type === "text" || item.type === "instructions") {
    return {
      text: item.type === "text" ? item.text : item.instructions,
      image: null,
    };
  }

  if (item.type === "file" && item.file.type === "image") {
    return {
      text: null,
      image: item.file.base64,
    };
  }

  // TODO: documents, thinking, etc.
  return { text: null, image: null };
}
