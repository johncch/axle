import OpenAI from "openai";
import { getTextContent } from "../../messages/chat.js";
import { AxleMessage } from "../../messages/types.js";
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
  tools?: Array<ToolDefinition>;
  context: { recorder?: Recorder };
}): Promise<ModelResult> {
  const { client, model, messages, tools, context } = params;
  const { recorder } = context;

  let chatTools = toModelTools(tools);
  const request = {
    model,
    messages: convertAxleMessagesToChatCompletion(messages),
    ...(chatTools && { tools: chatTools }),
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
    const toolCalls = choice.message.tool_calls
      ?.filter((item) => item.type === "function")
      ?.map((call) => ({
        type: "tool-call" as const,
        id: call.id,
        name: call.function.name,
        parameters: call.function.arguments,
      }));

    const contentParts = [{ type: "text" as const, text: choice.message.content ?? "" }];
    return {
      type: "success",
      id: completion.id,
      model: completion.model,
      role: choice.message.role,
      finishReason: convertStopReason(choice.finish_reason),
      content: contentParts,
      text: getTextContent(contentParts) ?? "",
      toolCalls: toolCalls,
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
