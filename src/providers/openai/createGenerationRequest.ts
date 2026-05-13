import OpenAI from "openai";
import {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseFunctionToolCall,
  ResponseReasoningItem,
} from "openai/resources/responses/responses.js";
import {
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
} from "../../messages/message.js";
import { getTextContent } from "../../messages/utils.js";
import { raceWithSignal, throwIfAborted } from "../../utils/abort.js";
import { redactResolvedFileValues } from "../../utils/redact.js";
import { AxleStopReason, GenerationRequestParams, ModelResult } from "../types.js";
import { getUndefinedError } from "../utils.js";
import { convertAxleMessageToResponseInput, prepareTools, toOpenAIReasoning } from "./utils.js";

export async function createGenerationRequest(
  params: GenerationRequestParams & { client: OpenAI; model: string },
): Promise<ModelResult> {
  const { client, model, messages, system, tools, context, options, reasoning, signal } = params;
  const tracer = context?.tracer;

  let result: ModelResult;
  try {
    throwIfAborted(signal, "Generate aborted");

    const modelTools = prepareTools(tools);
    const input = await convertAxleMessageToResponseInput(messages, {
      model,
      fileResolver: context?.fileResolver,
      signal,
    });
    const request: ResponseCreateParamsNonStreaming = {
      model,
      input,
      ...(system && { instructions: system }),
      ...(modelTools ? { tools: modelTools } : {}),
      ...toOpenAIReasoning(reasoning),
      ...options,
    };

    tracer?.debug("OpenAI ResponsesAPI request", { request: redactResolvedFileValues(request) });

    const response = await raceWithSignal(
      client.responses.create(request, ...(signal ? [{ signal }] : [])),
      signal,
      "Generate aborted",
    );
    throwIfAborted(signal, "Generate aborted");
    result = fromModelResponse(response);
  } catch (e) {
    throwIfAborted(signal, "Generate aborted");
    tracer?.error(e instanceof Error ? e.message : String(e));
    result = getUndefinedError(e);
  }

  tracer?.debug("OpenAI ResponsesAPI response", { result });
  return result;
}

export function fromModelResponse(response: Response): ModelResult {
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

  const reasoningItems = response.output
    ?.filter((item) => item.type === "reasoning")
    ?.map((item: ResponseReasoningItem) => item);

  const content: Array<ContentPartText | ContentPartThinking | ContentPartToolCall> = [];

  if (reasoningItems && reasoningItems.length > 0) {
    for (const reasoning of reasoningItems) {
      const thinkingText = reasoning.summary?.[0]?.text || reasoning.content?.[0]?.text || "";

      if (thinkingText || reasoning.encrypted_content) {
        content.push({
          type: "thinking" as const,
          text: thinkingText,
          ...(reasoning.encrypted_content && { encrypted: reasoning.encrypted_content }),
        });
      }
    }
  }

  if (response.output_text) {
    content.push({ type: "text" as const, text: response.output_text });
  }

  const toolCallItems = response.output?.filter((item) => item.type === "function_call");
  if (toolCallItems && toolCallItems.length > 0) {
    for (const item of toolCallItems) {
      const toolCall = item as ResponseFunctionToolCall;
      try {
        content.push({
          type: "tool-call" as const,
          id: toolCall.call_id || toolCall.id || "",
          name: toolCall.name || "",
          parameters: toolCall.arguments ? JSON.parse(toolCall.arguments) : {},
        });
      } catch (e) {
        throw new Error(
          `Failed to parse tool call arguments for ${toolCall.name}: ${e instanceof Error ? e.message : String(e)}\nRaw value: ${toolCall.arguments}`,
        );
      }
    }
  }

  return {
    type: "success",
    id: response.id,
    model: response.model || "",
    role: "assistant" as const,
    finishReason: response.incomplete_details
      ? AxleStopReason.Error
      : toolCallItems && toolCallItems.length > 0
        ? AxleStopReason.FunctionCall
        : AxleStopReason.Stop,
    content,
    text: getTextContent(content),
    usage: {
      in: response.usage?.input_tokens ?? 0,
      out: response.usage?.output_tokens ?? 0,
    },
    raw: response,
  };
}
