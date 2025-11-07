import OpenAI from "openai";
import {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseFunctionToolCall,
} from "openai/resources/responses/responses.js";
import z from "zod";
import { Chat, getInstructions, getTextContent } from "../../messages/chat.js";
import { AxleMessage } from "../../messages/types.js";
import { Recorder } from "../../recorder/recorder.js";
import { ToolDefinition } from "../../tools/types.js";
import { AxleStopReason, GenerationResult } from "../types.js";
import { getUndefinedError } from "../utils.js";
import { convertAxleMessageToResponseInput } from "./utils/responsesAPI.js";

export async function createGenerationRequestWithResponsesAPI(params: {
  client: OpenAI;
  model: string;
  messages: Array<AxleMessage>;
  tools?: Array<ToolDefinition>;
  context: { recorder?: Recorder };
}): Promise<GenerationResult> {
  const { client, model, messages, tools, context } = params;
  const { recorder } = context;

  const request: ResponseCreateParamsNonStreaming = {
    model,
    input: convertAxleMessageToResponseInput(messages),
  };

  if (tools && tools.length > 0) {
    request.tools = tools.map((tool) => {
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

  recorder?.debug?.log(request);

  let result: GenerationResult;
  try {
    const response = await client.responses.create(request);
    result = fromModelResponse(response);
  } catch (e) {
    recorder?.error?.log(e);
    result = getUndefinedError(e);
  }

  recorder?.debug?.log(result);
  return result;
}

export function prepareRequest(chat: Chat, model: string): ResponseCreateParamsNonStreaming {
  const request: ResponseCreateParamsNonStreaming = {
    model,
    input: convertAxleMessageToResponseInput(chat.messages),
  };

  const mostRecentMessage = chat.latest();
  if (mostRecentMessage && mostRecentMessage.role === "user") {
    let instructions = "";
    const msgInstructions = getInstructions(mostRecentMessage.content);
    if (chat.system) {
      instructions = chat.system;
    }
    if (msgInstructions) {
      instructions = instructions ? `${instructions}\n\n${msgInstructions}` : msgInstructions;
    }
    if (instructions) {
      request.instructions = instructions;
    }
  }

  if (chat.tools.length > 0) {
    request.tools = chat.tools.map((tool) => {
      const jsonSchema = z.toJSONSchema(tool.schema);
      return {
        type: "function",
        strict: true,
        name: tool.name,
        description: tool.description,
        parameters: jsonSchema,
      };
    });
  }

  return request;
}

export function fromModelResponse(response: Response): GenerationResult {
  if (response.error) {
    return {
      type: "error",
      error: {
        type: response.error.code || "undetermined",
        message: response.error.message || "Response generation failed",
      },
      usage: {
        in: response.usage?.input_tokens ?? 0,
        out: response.usage?.output_tokens ?? 0,
      },
      raw: response,
    };
  }

  // TODO: Refactor Messages to hold function calls
  const toolCalls = response.output
    ?.filter((item) => item.type === "function_call")
    ?.map((item: ResponseFunctionToolCall) => ({
      type: "tool-call" as const,
      id: item.id || "",
      name: item.name || "",
      parameters: item.arguments || "",
    }));

  const contentParts = [{ type: "text" as const, text: response.output_text || "" }];
  return {
    type: "success",
    id: response.id,
    model: response.model || "",
    role: "assistant" as const,
    reason: response.incomplete_details ? AxleStopReason.Error : AxleStopReason.Stop,
    content: contentParts,
    text: getTextContent(contentParts) ?? "",
    ...(toolCalls?.length && { toolCalls }),
    usage: {
      in: response.usage?.input_tokens ?? 0,
      out: response.usage?.output_tokens ?? 0,
    },
    raw: response,
  };
}
