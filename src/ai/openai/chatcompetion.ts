import OpenAI from "openai";
import {
  ChatCompletionContentPart,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionTool,
} from "openai/resources";
import { Recorder } from "../../recorder/recorder.js";
import {
  Chat,
  getDocuments,
  getImages,
  getTextAndInstructions,
} from "../chat.js";
import { AIRequest, AIResponse, StopReason } from "../types.js";
import { OpenAIProvider } from "./provider.js";

export class OpenAIChatCompletionRequest implements AIRequest {
  constructor(
    private provider: OpenAIProvider,
    private chat: Chat,
  ) {}

  async execute(runtime: { recorder?: Recorder }): Promise<AIResponse> {
    const { recorder } = runtime;
    const { client, model } = this.provider;
    const request = prepareRequest(this.chat, model);
    recorder?.debug?.heading.log(
      "[Open AI Provider] Using the ChatCompletion API",
    );
    recorder?.debug?.log(request);

    let result: AIResponse;
    try {
      const completion = await client.chat.completions.create(request);
      result = translateResponse(completion);
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

function getStopReason(reason: string) {
  switch (reason) {
    case "length":
      return StopReason.Length;
    case "stop":
      return StopReason.Stop;
    case "tool_calls":
      return StopReason.FunctionCall;
    default:
      return StopReason.Error;
  }
}

export function prepareRequest(
  chat: Chat,
  model: string,
): ChatCompletionCreateParamsNonStreaming {
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

  const messages: ChatCompletionMessageParam[] = chat.messages
    .map((msg) => {
      if (msg.role === "tool") {
        return msg.content.map((r) => ({
          role: "tool" as const,
          tool_call_id: r.id,
          content: r.content,
        }));
      }

      if (msg.role === "assistant") {
        const toolCalls = msg.toolCalls?.map((call) => {
          const id = call.id;
          return {
            type: "function",
            function: {
              name: call.name,
              arguments:
                typeof call.arguments === "string"
                  ? call.arguments
                  : JSON.stringify(call.arguments),
            },
            ...(id && { id }),
          };
        });
        return {
          role: msg.role,
          content: msg.content,
          ...(toolCalls && { toolCalls }),
        };
      }

      if (typeof msg.content === "string") {
        return {
          role: msg.role,
          content: msg.content,
        };
      } else {
        const content: ChatCompletionContentPart[] = [];
        const text = getTextAndInstructions(msg.content);
        if (text) {
          content.push({
            type: "text",
            text,
          });
        }

        const images = getImages(msg.content);
        if (images.length > 0) {
          content.push(
            ...images.map((img) => ({
              type: "image_url" as const,
              image_url: {
                url: `data:${img.mimeType};base64,${img.base64}`,
              },
            })),
          );
        }

        const documents = getDocuments(msg.content);
        if (documents.length > 0) {
          content.push(
            ...documents.map((doc) => ({
              type: "file" as const,
              file: {
                filename: doc.name,
                file_data: `data:${doc.mimeType};base64,${doc.base64}`,
              },
            })),
          );
        }
        return {
          role: msg.role,
          content,
        };
      }
    })
    .flat(1);

  return {
    model,
    messages: [...systemMsg, ...messages],
    ...(tools && { tools }),
  };
}

function translateResponse(
  completion: OpenAI.Chat.Completions.ChatCompletion,
): AIResponse {
  if (completion.choices.length > 0) {
    const choice = completion.choices[0];
    const toolCalls = choice.message.tool_calls?.map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    }));

    return {
      type: "success",
      id: completion.id,
      model: completion.model,
      reason: getStopReason(choice.finish_reason),
      message: {
        content: choice.message.content ?? "",
        role: choice.message.role,
        toolCalls: toolCalls,
      },
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
