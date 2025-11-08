import { GenerateContentResponse, GoogleGenAI } from "@google/genai";
import { getTextContent } from "../../messages/chat.js";
import { AxleMessage, ContentPartText, ContentPartThinking, ContentPartToolCall } from "../../messages/types.js";
import { Recorder } from "../../recorder/recorder.js";
import { ToolDefinition } from "../../tools/types.js";
import { AxleStopReason, ModelResult } from "../types.js";
import { getUndefinedError } from "../utils.js";
import { convertAxleMessagesToGoogleAI, convertStopReason, prepareConfig } from "./utils.js";

export async function createGenerationRequest(params: {
  client: GoogleGenAI;
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

  // Convert max_tokens to maxOutputTokens for Google AI
  const googleOptions = options ? { ...options } : {};
  if (googleOptions.max_tokens) {
    googleOptions.maxOutputTokens = googleOptions.max_tokens;
    delete googleOptions.max_tokens;
  }
  // Convert stop to stopSequences for Google AI
  if (googleOptions.stop) {
    googleOptions.stopSequences = Array.isArray(googleOptions.stop)
      ? googleOptions.stop
      : [googleOptions.stop];
    delete googleOptions.stop;
  }
  // Convert top_p to topP for Google AI
  if (googleOptions.top_p !== undefined) {
    googleOptions.topP = googleOptions.top_p;
    delete googleOptions.top_p;
  }

  const request = {
    contents: convertAxleMessagesToGoogleAI(messages),
    config: prepareConfig(tools, system, googleOptions),
  };
  recorder?.debug?.log(request);

  let result: ModelResult;
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

function fromModelResponse(
  response: GenerateContentResponse,
  runtime: { recorder?: Recorder },
): ModelResult {
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
  const textContent = parts
    .map((part) => part.text)
    .filter((text) => text !== undefined)
    .join("");

  const [success, reason] = convertStopReason(candidate.finishReason);
  if (success) {
    const content: Array<ContentPartText | ContentPartThinking | ContentPartToolCall> = [];

    if (textContent) {
      content.push({ type: "text" as const, text: textContent });
    }

    if (response.functionCalls) {
      for (const call of response.functionCalls) {
        if (typeof call.args !== "object" || call.args === null || Array.isArray(call.args)) {
          throw new Error(
            `Invalid tool call arguments for ${call.name}: expected object, got ${typeof call.args}`,
          );
        }
        content.push({
          type: "tool-call" as const,
          id: call.id,
          name: call.name,
          parameters: call.args as Record<string, unknown>,
        });
      }
    }

    return {
      type: "success",
      id: response.responseId,
      model: response.modelVersion,
      role: "assistant",
      finishReason: response.functionCalls ? AxleStopReason.FunctionCall : reason,
      content,
      text: getTextContent(content) ?? "",
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
