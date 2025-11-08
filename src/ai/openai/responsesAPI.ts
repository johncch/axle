import OpenAI from "openai";
import {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseFunctionToolCall,
  ResponseReasoningItem,
} from "openai/resources/responses/responses.js";
import { getTextContent } from "../../messages/chat.js";
import { AxleMessage, ContentPartText, ContentPartThinking } from "../../messages/types.js";
import { Recorder } from "../../recorder/recorder.js";
import { ToolDefinition } from "../../tools/types.js";
import { AxleStopReason, ModelResult } from "../types.js";
import { getUndefinedError } from "../utils.js";
import { convertAxleMessageToResponseInput, prepareTools } from "./utils/responsesAPI.js";

export async function createGenerationRequestWithResponsesAPI(params: {
  client: OpenAI;
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

  const modelTools = prepareTools(tools);
  const request: ResponseCreateParamsNonStreaming = {
    model,
    input: convertAxleMessageToResponseInput(messages),
    ...(system && { instructions: system }),
    ...(modelTools ? { tools: modelTools } : {}),
    ...options,
  };

  recorder?.debug?.log(request);

  let result: ModelResult;
  try {
    const response = await client.responses.create(request);
    result = fromModelResponse(response);
  } catch (e) {
    recorder?.error?.log(e);
    result = getUndefinedError(e);
  }

  recorder?.debug?.log(result);
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

  // TODO: Refactor Messages to hold function calls
  const toolCalls = response.output
    ?.filter((item) => item.type === "function_call")
    ?.map((item: ResponseFunctionToolCall) => {
      try {
        return {
          type: "tool-call" as const,
          id: item.id || "",
          name: item.name || "",
          parameters: item.arguments ? JSON.parse(item.arguments) : {},
        };
      } catch (e) {
        throw new Error(
          `Failed to parse tool call arguments for ${item.name}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    });

  const reasoningItems = response.output
    ?.filter((item) => item.type === "reasoning")
    ?.map((item: ResponseReasoningItem) => item);

  const contentParts: Array<ContentPartText | ContentPartThinking> = [];

  if (reasoningItems && reasoningItems.length > 0) {
    for (const reasoning of reasoningItems) {
      const thinkingText = reasoning.summary?.[0]?.text || reasoning.content?.[0]?.text || "";

      if (thinkingText || reasoning.encrypted_content) {
        contentParts.push({
          type: "thinking" as const,
          text: thinkingText,
          ...(reasoning.encrypted_content && { encrypted: reasoning.encrypted_content }),
        });
      }
    }
  }

  if (response.output_text) {
    contentParts.push({ type: "text" as const, text: response.output_text });
  }

  return {
    type: "success",
    id: response.id,
    model: response.model || "",
    role: "assistant" as const,
    finishReason: response.incomplete_details ? AxleStopReason.Error : AxleStopReason.Stop,
    content: contentParts,
    text: getTextContent(contentParts) ?? "",
    ...(toolCalls?.length && { toolCalls }),
    usage: {
      in: response.usage?.input_tokens ?? 0,
      out: response.usage?.output_tokens ?? 0,
    },
    raw: response,
  };
}
