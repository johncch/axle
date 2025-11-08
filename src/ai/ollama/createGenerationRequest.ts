import { getTextContent } from "../../messages/chat.js";
import { AxleMessage, ContentPartToolCall } from "../../messages/types.js";
import { Recorder } from "../../recorder/recorder.js";
import { ToolDefinition } from "../../tools/types.js";
import { AxleStopReason, ModelResult } from "../types.js";
import { getUndefinedError } from "../utils.js";
import { convertAxleMessagesToOllama, convertToolDefToOllama } from "./utils.js";

interface OllamaGenerationResponse {
  model: string;
  done_reason?: string;
  message?: {
    role: string;
    content: string;
    tool_calls?: Array<{
      id: string;
      function: {
        name: string;
        arguments: unknown;
      };
    }>;
  };
  prompt_eval_count?: number;
  eval_count?: number;
}

export async function createGenerationRequest(params: {
  url: string;
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
  const { url, model, messages, system, tools, context, options } = params;
  const { recorder } = context;

  const chatTools = convertToolDefToOllama(tools);

  // Convert parameter names for Ollama
  const ollamaOptions = options ? { ...options } : { temperature: 0.7 };
  if (ollamaOptions.max_tokens) {
    ollamaOptions.num_predict = ollamaOptions.max_tokens;
    delete ollamaOptions.max_tokens;
  }

  const requestBody = {
    model,
    messages: convertAxleMessagesToOllama(messages),
    stream: false,
    options: ollamaOptions,
    ...(system && { system }),
    ...(chatTools && { tools: chatTools }),
  };

  recorder?.debug?.log(requestBody);

  let result: ModelResult;
  try {
    const response = await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    result = fromModelResponse(data);
  } catch (e) {
    recorder?.error?.log("Error fetching Ollama response:", e);
    result = getUndefinedError(e);
  }

  recorder?.debug?.log(result);
  return result;
}

function fromModelResponse(data: OllamaGenerationResponse): ModelResult {
  if (data.done_reason === "stop" && data.message) {
    const content = data.message.content;
    const toolCalls: ContentPartToolCall[] = [];
    if (data.message.tool_calls) {
      for (const call of data.message.tool_calls) {
        // Validate that arguments is an object
        if (
          typeof call.function.arguments !== "object" ||
          call.function.arguments === null ||
          Array.isArray(call.function.arguments)
        ) {
          throw new Error(
            `Invalid tool call arguments for ${call.function.name}: expected object, got ${typeof call.function.arguments}`,
          );
        }
        toolCalls.push({
          type: "tool-call",
          id: call.id,
          name: call.function.name,
          parameters: call.function.arguments as Record<string, unknown>,
        });
      }
    }
    const hasToolCalls = toolCalls.length > 0;
    const contentParts = [{ type: "text" as const, text: content }];

    return {
      type: "success",
      id: `ollama-${Date.now()}`,
      model: data.model,
      role: "assistant",
      finishReason: hasToolCalls ? AxleStopReason.FunctionCall : AxleStopReason.Stop,
      content: contentParts,
      text: getTextContent(contentParts) ?? "",
      ...(hasToolCalls && { toolCalls }),
      usage: {
        in: data.prompt_eval_count || 0,
        out: data.eval_count || 0,
      },
      raw: data,
    };
  }

  return {
    type: "error",
    error: {
      type: "OllamaError",
      message: "Unexpected error from Ollama",
    },
    usage: {
      in: 0,
      out: 0,
    },
    raw: data,
  };
}
