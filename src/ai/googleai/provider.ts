import {
  Content,
  FinishReason,
  GenerateContentConfig,
  GenerateContentResponse,
  GoogleGenAI,
  Type,
} from "@google/genai";
import { Recorder } from "../../recorder/recorder.js";
import {
  Chat,
  getDocuments,
  getImages,
  getTextAndInstructions,
} from "../chat.js";
import {
  AIProvider,
  AIRequest,
  AIResponse,
  StopReason,
  ToolCall,
} from "../types.js";
import { Models, MULTIMODAL_MODELS } from "./models.js";

const DEFAULT_MODEL = Models.GEMINI_2_5_FLASH_PREVIEW_05_20;

export class GoogleAIProvider implements AIProvider {
  name = "GoogleAI";
  client: GoogleGenAI;
  model: string;

  constructor(apiKey: string, model?: string) {
    this.model = model ?? DEFAULT_MODEL;
    this.client = new GoogleGenAI({ apiKey: apiKey });
  }

  createChatRequest(
    chat: Chat,
    context: { recorder?: Recorder } = {},
  ): AIRequest {
    const { recorder } = context;
    if (chat.hasFiles() && !MULTIMODAL_MODELS.includes(this.model as any)) {
      recorder?.warn.log(
        `Model ${this.model} does not support multimodal content. Use one of: ${MULTIMODAL_MODELS.join(", ")}`,
      );
    }
    return new GoogleAIChatRequest(this, chat);
  }
}

class GoogleAIChatRequest implements AIRequest {
  constructor(
    private provider: GoogleAIProvider,
    private chat: Chat,
  ) {}

  async execute(runtime: { recorder?: Recorder }): Promise<AIResponse> {
    const { recorder } = runtime;
    const { client, model } = this.provider;

    const request = prepareRequest(this.chat);
    recorder?.debug?.log(request);

    let result: AIResponse;
    try {
      const response = await client.models.generateContent({
        model,
        ...request,
      });
      result = translateResponse(response, runtime);
    } catch (e) {
      recorder?.error?.log(e);
      result = {
        type: "error",
        error: {
          type: e.name ?? "Undetermined",
          message: e.message ?? "Unexpected error from Google AI",
        },
        usage: { in: 0, out: 0 },
        raw: e,
      };
    }

    recorder?.debug?.log(result);
    return result;
  }
}

export function prepareRequest(chat: Chat) {
  let contents: string | Content[];

  if (
    chat.messages.length === 1 &&
    chat.messages[0].role == "user" &&
    typeof chat.messages[0].content === "string"
  ) {
    // If there's only one user message with string content, we can send it as a string
    contents = chat.messages[0].content;
  } else {
    contents = chat.messages.map((message) => {
      if (message.role === "user") {
        if (typeof message.content === "string") {
          return { role: "user", parts: [{ text: message.content }] };
        } else {
          const parts: any[] = [];
          const text = getTextAndInstructions(message.content);
          if (text) {
            parts.push({ text });
          }

          const images = getImages(message.content);
          if (images.length > 0) {
            parts.push(
              ...images.map((img) => ({
                inlineData: {
                  mimeType: img.mimeType,
                  data: img.base64,
                },
              })),
            );
          }

          const documents = getDocuments(message.content);
          if (documents.length > 0) {
            parts.push(
              ...documents.map((doc) => ({
                inlineData: {
                  mimeType: doc.mimeType,
                  data: doc.base64,
                },
              })),
            );
          }

          return { role: "user", parts };
        }
      } else if (message.role === "assistant") {
        const results: Content = {
          role: "assistant",
          parts: [],
        };
        if (message.content !== undefined) {
          results.parts.push({ text: message.content });
        }
        if (message.toolCalls) {
          results.parts = results.parts.concat(
            message.toolCalls.map((item) => {
              let parsedArgs: Record<string, unknown>;
              if (typeof item.arguments === "string") {
                parsedArgs = JSON.parse(item.arguments) as Record<
                  string,
                  unknown
                >;
              } else {
                parsedArgs = item.arguments as Record<string, unknown>;
              }
              return {
                functionCall: {
                  id: item.id ?? undefined,
                  name: item.name,
                  args: parsedArgs,
                },
              };
            }),
          );
        }
        return results;
      } else if (message.role === "tool") {
        return {
          role: "user",
          parts: message.content.map((item) => ({
            functionResponse: {
              id: item.id ?? undefined,
              name: item.name,
              response: {
                output: item.content,
              },
            },
          })),
        };
      }
    });
  }

  const config: GenerateContentConfig = {};
  if (chat.system) {
    config.systemInstruction = chat.system;
  }
  if (chat.tools.length > 0) {
    config.tools = chat.tools.map((tool) => ({
      functionDeclarations: [
        {
          name: tool.name,
          description: tool.description,
          parameters: {
            ...tool.parameters,
            type: Type.OBJECT,
          },
        },
      ],
    }));
  }

  return { contents, config };
}

function translateResponse(
  response: GenerateContentResponse,
  runtime: { recorder?: Recorder },
): AIResponse {
  const { recorder } = runtime;

  const inTokens = response.usageMetadata.promptTokenCount;
  const outTokens = response.usageMetadata.totalTokenCount - inTokens;
  const usage = { in: inTokens, out: outTokens };

  if (!response) {
    return {
      type: "error",
      error: {
        type: "InvalidResponse",
        message: "Invalid or empty response from Google AI",
      },
      usage: { in: 0, out: 0 },
      raw: response,
    };
  }

  if (response.promptFeedback && response.promptFeedback.blockReason) {
    return {
      type: "error",
      error: {
        type: "Blocked",
        message: `Response blocked by Google AI: ${response.promptFeedback.blockReason}, ${response.promptFeedback.blockReasonMessage}`,
      },
      usage,
      raw: response,
    };
  }

  if (!response.candidates || response.candidates.length === 0) {
    return {
      type: "error",
      error: {
        type: "InvalidResponse",
        message: "Invalid or empty response from Google AI",
      },
      usage: { in: 0, out: 0 },
      raw: response,
    };
  }

  if (response.candidates.length > 1) {
    recorder?.warn?.log(
      `We received ${response.candidates.length} response candidates`,
    );
  }

  const candidate = response.candidates[0];
  const parts = candidate.content?.parts || [];
  const content = parts
    .map((part) => part.text)
    .filter((text) => text !== undefined)
    .join("");

  const [success, reason] = getStopReason(candidate.finishReason);
  if (success) {
    let toolCalls: ToolCall[] | undefined;
    if (response.functionCalls) {
      toolCalls = response.functionCalls.map((call) => ({
        id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.args),
      }));
    }
    return {
      type: "success",
      id: response.responseId,
      model: response.modelVersion,
      reason: response.functionCalls ? StopReason.FunctionCall : reason,
      message: {
        role: "assistant",
        ...(content ? { content } : {}),
        ...(toolCalls ? { toolCalls } : {}),
      },
      usage,
      raw: response,
    };
  } else {
    return {
      type: "error",
      error: {
        type: "Undetermined",
        message: `Unexpected stop reason: ${reason}`,
      },
      usage,
      raw: response,
    };
  }
}

function getStopReason(reason: FinishReason): [boolean, StopReason] {
  switch (reason) {
    case FinishReason.STOP:
      return [true, StopReason.Stop];
    case FinishReason.MAX_TOKENS:
      return [true, StopReason.Length];
    case FinishReason.FINISH_REASON_UNSPECIFIED:
    case FinishReason.SAFETY:
    case FinishReason.RECITATION:
    case FinishReason.LANGUAGE:
    case FinishReason.OTHER:
    case FinishReason.BLOCKLIST:
    case FinishReason.PROHIBITED_CONTENT:
    case FinishReason.SPII:
    case FinishReason.MALFORMED_FUNCTION_CALL:
    case FinishReason.IMAGE_SAFETY:
      return [false, StopReason.Error];
  }
}
