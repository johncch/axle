import { GenerateContentConfig, GenerateContentResponse, GoogleGenAI, Type } from "@google/genai";
import z from "zod";
import { getTextContent } from "../../messages/chat.js";
import { AxleMessage, ContentPartToolCall } from "../../messages/types.js";
import { Recorder } from "../../recorder/recorder.js";
import { ToolDefinition } from "../../tools/types.js";
import { AIProvider, AxleStopReason, GenerationResult } from "../types.js";
import { getUndefinedError } from "../utils.js";
import { DEFAULT_MODEL } from "./models.js";
import { convertAxleMessagesToGoogleAI, convertStopReason } from "./utils.js";

export class GoogleAIProvider implements AIProvider {
  name = "GoogleAI";
  client: GoogleGenAI;
  model: string;

  constructor(apiKey: string, model?: string) {
    this.model = model ?? DEFAULT_MODEL;
    this.client = new GoogleGenAI({ apiKey: apiKey });
  }

  async createGenerationRequest(params: {
    messages: Array<AxleMessage>;
    tools?: Array<ToolDefinition>;
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
  tools?: Array<ToolDefinition>;
  context: { recorder?: Recorder };
}): Promise<GenerationResult> {
  const { client, model, messages, tools, context } = params;
  const { recorder } = context;

  const request = {
    contents: convertAxleMessagesToGoogleAI(messages),
    config: prepareConfig(tools),
  };
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
    result = getUndefinedError(e);
  }

  recorder?.debug?.log(result);
  return result;
}

function prepareConfig(tools: Array<ToolDefinition>, system?: string): GenerateContentConfig {
  const config: GenerateContentConfig = {};

  if (system) {
    config.systemInstruction = system;
  }

  if (tools.length > 0) {
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
        parameters: JSON.stringify(call.args),
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
