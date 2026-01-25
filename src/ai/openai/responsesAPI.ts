import OpenAI from "openai";
import {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseFunctionToolCall,
  ResponseReasoningItem,
} from "openai/resources/responses/responses.js";
import {
  AxleMessage,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
} from "../../messages/types.js";
import { getTextContent } from "../../messages/utils.js";
import type { TracingContext } from "../../tracer/types.js";
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
  context: { tracer?: TracingContext };
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
  const tracer = context?.tracer;

  const modelTools = prepareTools(tools);
  const request: ResponseCreateParamsNonStreaming = {
    model,
    input: convertAxleMessageToResponseInput(messages),
    ...(system && { instructions: system }),
    ...(modelTools ? { tools: modelTools } : {}),
    ...options,
  };

  tracer?.debug("OpenAI ResponsesAPI request", { request });

  let result: ModelResult;
  try {
    const response = await client.responses.create(request);
    result = fromModelResponse(response);
  } catch (e) {
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
          id: toolCall.id || "",
          name: toolCall.name || "",
          parameters: toolCall.arguments ? JSON.parse(toolCall.arguments) : {},
        });
      } catch (e) {
        throw new Error(
          `Failed to parse tool call arguments for ${toolCall.name}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  return {
    type: "success",
    id: response.id,
    model: response.model || "",
    role: "assistant" as const,
    finishReason: response.incomplete_details ? AxleStopReason.Error : AxleStopReason.Stop,
    content,
    text: getTextContent(content) ?? "",
    usage: {
      in: response.usage?.input_tokens ?? 0,
      out: response.usage?.output_tokens ?? 0,
    },
    raw: response,
  };
}
