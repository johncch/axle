import {
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
} from "../../messages/message.js";
import { getTextContent } from "../../messages/utils.js";
import type { TracingContext } from "../../tracer/types.js";
import { ToolDefinition } from "../../tools/types.js";
import { AxleMessage } from "../../messages/message.js";
import { ModelResult } from "../types.js";
import { getUndefinedError } from "../utils.js";
import { ChatCompletionResponse } from "./types.js";
import { convertAxleMessages, convertFinishReason, convertTools } from "./utils.js";

export async function createGenerationRequest(params: {
  baseUrl: string;
  model: string;
  messages: Array<AxleMessage>;
  system?: string;
  tools?: Array<ToolDefinition>;
  context: { tracer?: TracingContext };
  apiKey?: string;
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
  const { baseUrl, model, messages, system, tools, context, apiKey, options } = params;
  const tracer = context?.tracer;

  const chatMessages = convertAxleMessages(messages, system);
  const chatTools = convertTools(tools);

  const requestBody: Record<string, any> = {
    model,
    messages: chatMessages,
    ...(chatTools && { tools: chatTools }),
  };

  if (options) {
    if (options.temperature !== undefined) requestBody.temperature = options.temperature;
    if (options.top_p !== undefined) requestBody.top_p = options.top_p;
    if (options.max_tokens !== undefined) requestBody.max_tokens = options.max_tokens;
    if (options.frequency_penalty !== undefined) requestBody.frequency_penalty = options.frequency_penalty;
    if (options.presence_penalty !== undefined) requestBody.presence_penalty = options.presence_penalty;
    if (options.stop !== undefined) requestBody.stop = options.stop;
  }

  tracer?.debug("ChatCompletions request", { request: requestBody });

  let result: ModelResult;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`HTTP error! status: ${response.status}${errorText ? ` - ${errorText}` : ""}`);
    }

    const data: ChatCompletionResponse = await response.json();
    result = fromModelResponse(data);
  } catch (e) {
    tracer?.error("Error fetching ChatCompletions response", {
      error: e instanceof Error ? e.message : String(e),
    });
    result = getUndefinedError(e);
  }

  tracer?.debug("ChatCompletions response", { result });
  return result;
}

function fromModelResponse(data: ChatCompletionResponse): ModelResult {
  const choice = data.choices?.[0];
  if (!choice) {
    return {
      type: "error",
      error: {
        type: "ChatCompletionsError",
        message: "No choices in response",
      },
      usage: { in: 0, out: 0 },
      raw: data,
    };
  }

  const content: Array<ContentPartText | ContentPartThinking | ContentPartToolCall> = [];

  if (choice.message.reasoning_content) {
    content.push({
      type: "thinking",
      text: choice.message.reasoning_content,
    });
  }

  if (choice.message.content) {
    content.push({
      type: "text",
      text: choice.message.content,
    });
  }

  if (choice.message.tool_calls) {
    for (const call of choice.message.tool_calls) {
      let parsedArgs: Record<string, unknown>;
      try {
        parsedArgs = JSON.parse(call.function.arguments);
      } catch (e) {
        throw new Error(
          `Invalid tool call arguments for ${call.function.name}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      if (typeof parsedArgs !== "object" || parsedArgs === null || Array.isArray(parsedArgs)) {
        throw new Error(
          `Invalid tool call arguments for ${call.function.name}: expected object, got ${typeof parsedArgs}`,
        );
      }

      content.push({
        type: "tool-call",
        id: call.id,
        name: call.function.name,
        parameters: parsedArgs,
      });
    }
  }

  const hasToolCalls = content.some((c) => c.type === "tool-call");
  const finishReason = hasToolCalls
    ? convertFinishReason("tool_calls")
    : convertFinishReason(choice.finish_reason);

  return {
    type: "success",
    id: data.id,
    model: data.model,
    role: "assistant",
    finishReason,
    content,
    text: getTextContent(content) ?? "",
    usage: {
      in: data.usage?.prompt_tokens || 0,
      out: data.usage?.completion_tokens || 0,
    },
    raw: data,
  };
}
