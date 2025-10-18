import OpenAI from "openai";
import {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionSystemMessageParam,
  ChatCompletionTool,
} from "openai/resources";
import { Chat, getTextContent } from "../../messages/chat.js";
import { Recorder } from "../../recorder/recorder.js";
import { convertStopReason } from "../anthropic/utils.js";
import { AIRequest, GenerationResult } from "../types.js";
import { OpenAIProvider } from "./provider.js";
import { convertAxleMessagesToChatCompletion } from "./utils/chatCompletion.js";

export class OpenAIChatCompletionRequest implements AIRequest {
  constructor(
    private provider: OpenAIProvider,
    private chat: Chat,
  ) {}

  async execute(runtime: { recorder?: Recorder }): Promise<GenerationResult> {
    const { recorder } = runtime;
    const { client, model } = this.provider;
    const request = prepareRequest(this.chat, model);
    recorder?.debug?.heading.log("[Open AI Provider] Using the ChatCompletion API");
    recorder?.debug?.log(request);

    let result: GenerationResult;
    try {
      const completion = await client.chat.completions.create(request);
      result = fromModelResponse(completion);
    } catch (e) {
      recorder?.error?.log(e);
      result = {
        type: "error",
        error: {
          type: e.type ?? "Undetermined",
          message: e.message ?? "Unexpected error from OpenAI",
        },
        usage: {
          in: 0,
          out: 0,
        },
        raw: e,
      };
    }
    recorder?.debug?.log(result);
    return result;
  }
}

export function prepareRequest(chat: Chat, model: string): ChatCompletionCreateParamsNonStreaming {
  const systemMsg: ChatCompletionSystemMessageParam[] = [];
  if (chat.system) {
    systemMsg.push({
      role: "system",
      content: chat.system,
    });
  }

  let tools: ChatCompletionTool[] | undefined = undefined;
  if (chat.tools.length > 0) {
    tools = chat.tools.map((schema) => {
      return {
        type: "function",
        function: schema,
      };
    });
  }

  return {
    model,
    messages: [...systemMsg, ...convertAxleMessagesToChatCompletion(chat.messages)],
    ...(tools && { tools }),
  };
}

export function fromModelResponse(
  completion: OpenAI.Chat.Completions.ChatCompletion,
): GenerationResult {
  if (completion.choices.length > 0) {
    const choice = completion.choices[0];
    const toolCalls = choice.message.tool_calls
      ?.filter((item) => item.type === "function")
      ?.map((call) => ({
        type: "tool-call" as const,
        id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
      }));

    const contentParts = [{ type: "text" as const, text: choice.message.content ?? "" }];
    return {
      type: "success",
      id: completion.id,
      model: completion.model,
      role: choice.message.role,
      reason: convertStopReason(choice.finish_reason),
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
