import Anthropic from "@anthropic-ai/sdk";
import { getTextContent } from "../../messages/chat.js";
import { AxleMessage } from "../../messages/types.js";
import { Recorder } from "../../recorder/recorder.js";
import { ToolDefinition } from "../../tools/types.js";
import { AxleStopReason, ModelResult } from "../types.js";
import { getUndefinedError } from "../utils.js";
import {
    convertStopReason,
    convertToAxleContentParts,
    convertToProviderMessages,
    convertToProviderTools,
} from "./utils.js";

export async function createGenerationRequest(params: {
  client: Anthropic;
  model: string;
  messages: Array<AxleMessage>;
  system?: string;
  tools?: Array<ToolDefinition>;
  context?: { recorder?: Recorder };
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

  // Convert stop to stop_sequences for Anthropic
  const anthropicOptions = options ? { ...options } : {};
  if (anthropicOptions.stop) {
    anthropicOptions.stop_sequences = Array.isArray(anthropicOptions.stop)
      ? anthropicOptions.stop
      : [anthropicOptions.stop];
    delete anthropicOptions.stop;
  }

  const request = {
    model: model,
    max_tokens: 4096,
    messages: convertToProviderMessages(messages),
    ...(system && { system }),
    ...(tools && { tools: convertToProviderTools(tools) }),
    ...anthropicOptions,
  };
  recorder?.debug?.log(request);

  let result: ModelResult;
  try {
    const completion = await client.messages.create(request);
    result = convertToAIResponse(completion);
  } catch (e) {
    result = getUndefinedError(e);
  }

  recorder?.debug?.log(result);
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
      text: getTextContent(content) ?? "",
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
      text: getTextContent(content) ?? "",
      usage: {
        in: completion.usage.input_tokens,
        out: completion.usage.output_tokens,
      },
      raw: completion,
    };
  }
}
