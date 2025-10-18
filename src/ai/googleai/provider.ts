import {
  Content,
  GenerateContentConfig,
  GenerateContentResponse,
  GoogleGenAI,
  Type,
} from "@google/genai";
import z from "zod";
import { Chat, getTextContent } from "../../messages/chat.js";
import { AxleMessage, ContentPartToolCall } from "../../messages/types.js";
import { Recorder } from "../../recorder/recorder.js";
import { ToolDef } from "../../tools/types.js";
import { AIProvider, AIRequest, AxleStopReason, GenerationResult } from "../types.js";
import { Models, MULTIMODAL_MODELS } from "./models.js";
import { convertAxleMessagesToGoogleAI, convertStopReason } from "./utils.js";

const DEFAULT_MODEL = Models.GEMINI_2_5_FLASH_PREVIEW_05_20;

export class GoogleAIProvider implements AIProvider {
  name = "GoogleAI";
  client: GoogleGenAI;
  model: string;

  constructor(apiKey: string, model?: string) {
    this.model = model ?? DEFAULT_MODEL;
    this.client = new GoogleGenAI({ apiKey: apiKey });
  }

  createChatRequest(chat: Chat, context: { recorder?: Recorder } = {}): AIRequest {
    const { recorder } = context;
    if (chat.hasFiles() && !MULTIMODAL_MODELS.includes(this.model as any)) {
      recorder?.warn.log(
        `Model ${this.model} does not support multimodal content. Use one of: ${MULTIMODAL_MODELS.join(", ")}`,
      );
    }
    return new GoogleAIChatRequest(this, chat);
  }

  async createGenerationRequest(params: {
    messages: Array<AxleMessage>;
    tools?: Array<ToolDef>;
    context: { recorder?: Recorder };
  }): Promise<GenerationResult> {
    return await createGenerationRequest({
      client: this.client,
      model: this.model,
      ...params,
    });
  }
}

async function createGenerationRequest(params: {
  client: GoogleGenAI;
  model: string;
  messages: Array<AxleMessage>;
  tools?: Array<ToolDef>;
  context: { recorder?: Recorder };
}): Promise<GenerationResult> {
  const { client, model, messages, tools, context } = params;
  const { recorder } = context;

  const contents = convertAxleMessagesToGoogleAI(messages);
  const config: GenerateContentConfig = {};

  if (tools && tools.length > 0) {
    config.tools = tools.map((tool) => {
      const jsonSchema = z.toJSONSchema(tool.schema) as any;
      return {
        functionDeclarations: [
          {
            name: tool.name,
            description: tool.description,
            parameters: {
              ...jsonSchema,
              type: Type.OBJECT,
            },
          },
        ],
      };
    });
  }

  const request = { contents, config };
  recorder?.debug?.log(request);

  let result: GenerationResult;
  try {
    const response = await client.models.generateContent({
      model,
      ...request,
    });
    result = fromModelResponse(response, { recorder });
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

class GoogleAIChatRequest implements AIRequest {
  constructor(
    private provider: GoogleAIProvider,
    private chat: Chat,
  ) {}

  async execute(runtime: { recorder?: Recorder }): Promise<GenerationResult> {
    const { recorder } = runtime;
    const { client, model } = this.provider;

    const request = prepareRequest(this.chat);
    recorder?.debug?.log(request);

    let result: GenerationResult;
    try {
      const response = await client.models.generateContent({
        model,
        ...request,
      });
      result = fromModelResponse(response, runtime);
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
  const contents = prepareContents(chat);
  const config = prepareConfig(chat);

  return { contents, config };
}

function prepareContents(chat: Chat): string | Content[] {
  if (
    chat.messages.length === 1 &&
    chat.messages[0].role == "user" &&
    typeof chat.messages[0].content === "string"
  ) {
    // If there's only one user message with string content, we can send it as a string
    return chat.messages[0].content;
  }

  return convertAxleMessagesToGoogleAI(chat.messages);
}

function prepareConfig(chat: Chat): GenerateContentConfig {
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

  return config;
}

function fromModelResponse(
  response: GenerateContentResponse,
  runtime: { recorder?: Recorder },
): GenerationResult {
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
    recorder?.warn?.log(`We received ${response.candidates.length} response candidates`);
  }

  const candidate = response.candidates[0];
  const parts = candidate.content?.parts || [];
  const content = parts
    .map((part) => part.text)
    .filter((text) => text !== undefined)
    .join("");

  const [success, reason] = convertStopReason(candidate.finishReason);
  if (success) {
    let toolCalls: ContentPartToolCall[] | undefined;
    if (response.functionCalls) {
      toolCalls = response.functionCalls.map((call) => ({
        type: "tool-call" as const,
        id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.args),
      }));
    }
    const contentParts = [{ type: "text" as const, text: content }];
    return {
      type: "success",
      id: response.responseId,
      model: response.modelVersion,
      role: "assistant",
      reason: response.functionCalls ? AxleStopReason.FunctionCall : reason,
      content: contentParts,
      text: getTextContent(contentParts) ?? "",
      ...(toolCalls ? { toolCalls } : {}),
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
