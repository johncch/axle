import Anthropic from "@anthropic-ai/sdk";
import { getTextContent } from "../../messages/utils.js";
import { redactResolvedFileValues } from "../../utils/file.js";
import { arrayify } from "../../utils/utils.js";
import { AxleStopReason, GenerationRequestParams, ModelResult } from "../types.js";
import { getUndefinedError } from "../utils.js";
import {
  convertStopReason,
  convertToAxleContentParts,
  convertToProviderMessages,
  convertToProviderTools,
} from "./utils.js";

export async function createGenerationRequest(
  params: GenerationRequestParams & { client: Anthropic; model: string },
): Promise<ModelResult> {
  const { client, model, messages, system, tools, context, options } = params;
  const tracer = context?.tracer;

  const { stop, max_tokens, ...restOptions } = options ?? {};

  let result: ModelResult;
  try {
    const providerMessages = await convertToProviderMessages(messages, {
      model,
      fileResolver: context?.fileResolver,
    });

    const request = {
      model: model,
      max_tokens: max_tokens ?? 16000,
      messages: providerMessages,
      ...(system && { system }),
      ...(stop && { stop_sequences: arrayify(stop) }),
      ...(tools && { tools: convertToProviderTools(tools) }),
      ...restOptions,
    };
    tracer?.debug("Anthropic request", { request: redactResolvedFileValues(request) });

    const completion = await client.messages.create(request);
    result = convertToAIResponse(completion);
  } catch (e) {
    result = getUndefinedError(e);
  }

  tracer?.debug("Anthropic response", { result });
  return result;
}

function convertToAIResponse(completion: Anthropic.Messages.Message): ModelResult {
  const stopReason = convertStopReason(completion.stop_reason);
  if (stopReason === AxleStopReason.Error) {
    return {
      type: "error",
      error: {
        type: "Uncaught error",
        message: `Stop reason is not recognized or unhandled: ${completion.stop_reason}`,
      },
      usage: {
        in: completion.usage.input_tokens,
        out: completion.usage.output_tokens,
      },
      raw: completion,
    };
  }

  if (stopReason === AxleStopReason.FunctionCall) {
    const content = convertToAxleContentParts(completion.content);
    return {
      type: "success",
      id: completion.id,
      model: completion.model,
      role: completion.role,
      finishReason: AxleStopReason.FunctionCall,
      content,
      text: getTextContent(content),
      usage: {
        in: completion.usage.input_tokens,
        out: completion.usage.output_tokens,
      },
      raw: completion,
    };
  }

  if (completion.type == "message") {
    const content = convertToAxleContentParts(completion.content);
    return {
      type: "success",
      id: completion.id,
      model: completion.model,
      role: "assistant" as const,
      finishReason: stopReason,
      content,
      text: getTextContent(content),
      usage: {
        in: completion.usage.input_tokens,
        out: completion.usage.output_tokens,
      },
      raw: completion,
    };
  }

  return {
    type: "error",
    error: {
      type: "InvalidResponse",
      message: `Unsupported completion type: ${completion.type}`,
    },
    usage: {
      in: completion.usage.input_tokens,
      out: completion.usage.output_tokens,
    },
    raw: completion,
  };
}
