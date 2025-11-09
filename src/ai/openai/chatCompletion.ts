import OpenAI from "openai";
import {
  AxleMessage,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
} from "../../messages/types.js";
import { getTextContent } from "../../messages/utils.js";
import { Recorder } from "../../recorder/recorder.js";
import { ToolDefinition } from "../../tools/types.js";
import { convertStopReason } from "../anthropic/utils.js";
import { ModelResult } from "../types.js";
import { getUndefinedError } from "../utils.js";
import { convertAxleMessagesToChatCompletion, toModelTools } from "./utils/chatCompletion.js";

export async function createGenerationRequestWithChatCompletion(params: {
  client: OpenAI;
  model: string;
  messages: Array<AxleMessage>;
  system?: string;
  tools?: Array<ToolDefinition>;
  context: { recorder?: Recorder };
  options?: {
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    stop?: string | string[];
    [key: string]: any;
  };
}): Promise<ModelResult> {
  const { client, model, messages, system, tools, context, options } = params;
  const { recorder } = context;

  let chatTools = toModelTools(tools);
  const request = {
    model,
    messages: convertAxleMessagesToChatCompletion(messages, system),
    ...(chatTools && { tools: chatTools }),
    ...options,
  };

  recorder?.debug?.log(request);

  let result: ModelResult;
  try {
    const completion = await client.chat.completions.create(request);
    result = fromModelResponse(completion);
  } catch (e) {
    recorder?.error?.log(e);
    result = getUndefinedError(e);
  }

  recorder?.debug?.log(result);
  return result;
}

export function fromModelResponse(completion: OpenAI.Chat.Completions.ChatCompletion): ModelResult {
  if (completion.choices.length > 0) {
    const choice = completion.choices[0];
    const content: Array<ContentPartText | ContentPartThinking | ContentPartToolCall> = [];

    if (choice.message.content) {
      content.push({ type: "text" as const, text: choice.message.content });
    }

    if (choice.message.tool_calls) {
      for (const call of choice.message.tool_calls) {
        if (call.type === "function") {
          try {
            content.push({
              type: "tool-call" as const,
              id: call.id,
              name: call.function.name,
              parameters: JSON.parse(call.function.arguments),
            });
          } catch (e) {
            throw new Error(
              `Failed to parse tool call arguments for ${call.function.name}: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
      }
    }

    return {
      type: "success",
      id: completion.id,
      model: completion.model,
      role: choice.message.role,
      finishReason: convertStopReason(choice.finish_reason),
      content,
      text: getTextContent(content) ?? "",
      usage: {
        in: completion.usage?.prompt_tokens ?? 0,
        out: completion.usage?.completion_tokens ?? 0,
      },
      raw: completion,
    };
  }

  return {
    type: "error",
    error: {
      type: "undetermined",
      message: "Unexpected response from OpenAI",
    },
    usage: {
      in: completion.usage?.prompt_tokens ?? 0,
      out: completion.usage?.completion_tokens ?? 0,
    },
    raw: completion,
  };
}
