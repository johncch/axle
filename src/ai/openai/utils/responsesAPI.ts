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
    type: "function_call_output" as const,
    call_id: r.id,
    output: r.content,
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
    content: getTextContent(msg.content), // TODO
    ...(toolCalls && { toolCalls }), // TODO
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
  // TODO: thinking, etc.
  return null;
}
