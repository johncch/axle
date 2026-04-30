import { GenerateContentResponse, GoogleGenAI } from "@google/genai";
import {
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
} from "../../messages/message.js";
import { getTextContent } from "../../messages/utils.js";
import type { TracingContext } from "../../tracer/types.js";
import { redactResolvedFileValues } from "../../utils/redact.js";
import { AxleStopReason, GenerationRequestParams, ModelResult } from "../types.js";
import { getUndefinedError } from "../utils.js";
import {
  convertAxleMessagesToGemini,
  convertStopReason,
  prepareConfig,
  toGeminiThinkingConfig,
} from "./utils.js";

export async function createGenerationRequest(
  params: GenerationRequestParams & { client: GoogleGenAI; model: string },
): Promise<ModelResult> {
  const { client, model, messages, system, tools, context, options, reasoning } = params;
  const tracer = context?.tracer;

  // Convert max_tokens to maxOutputTokens for Google AI; user options spread
  // after the reasoning translation so a raw thinkingConfig overrides ours.
  const googleOptions: Record<string, any> = {
    ...toGeminiThinkingConfig(reasoning),
    ...(options ?? {}),
  };
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

  let result: ModelResult;
  try {
    const contents = await convertAxleMessagesToGemini(messages, {
      model,
      fileResolver: context?.fileResolver,
    });

    const request = {
      contents,
      config: prepareConfig(tools, system, googleOptions),
    };
    tracer?.debug("Gemini request", { request: redactResolvedFileValues(request) });

    const response = await client.models.generateContent({
      model,
      ...request,
    });
    result = fromModelResponse(response, { tracer });
  } catch (e) {
    tracer?.error(e instanceof Error ? e.message : String(e));
    result = getUndefinedError(e);
  }

  tracer?.debug("Gemini response", { result });
  return result;
}

function fromModelResponse(
  response: GenerateContentResponse,
  context: { tracer?: TracingContext },
): ModelResult {
  const { tracer } = context;

  const inTokens = response.usageMetadata?.promptTokenCount ?? 0;
  const totalTokens = response.usageMetadata?.totalTokenCount ?? inTokens;
  const outTokens = totalTokens - inTokens;
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
    tracer?.warn(`We received ${response.candidates.length} response candidates`);
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
        if (call.args == null) {
          content.push({
            type: "tool-call" as const,
            id: call.id ?? "",
            name: call.name ?? "",
            parameters: {},
          });
        } else if (typeof call.args !== "object" || Array.isArray(call.args)) {
          throw new Error(
            `Invalid tool call arguments for ${call.name}: expected object, got ${typeof call.args}`,
          );
        } else {
          content.push({
            type: "tool-call" as const,
            id: call.id ?? "",
            name: call.name ?? "",
            parameters: call.args as Record<string, unknown>,
          });
        }
      }
    }

    return {
      type: "success",
      id: response.responseId ?? "",
      model: response.modelVersion ?? "",
      role: "assistant",
      finishReason: response.functionCalls ? AxleStopReason.FunctionCall : reason,
      content,
      text: getTextContent(content),
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
