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
  const { url, model, messages, system, tools, context, options } = params;
  const tracer = context?.tracer;

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

  tracer?.debug("Ollama request", { request: requestBody });

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
    tracer?.error("Error fetching Ollama response", { error: e instanceof Error ? e.message : String(e) });
    result = getUndefinedError(e);
  }

  tracer?.debug("Ollama response", { result });
  return result;
}

function fromModelResponse(data: OllamaGenerationResponse): ModelResult {
  if (data.done_reason === "stop" && data.message) {
    const content: Array<ContentPartText | ContentPartThinking | ContentPartToolCall> = [];

    if (data.message.content !== undefined) {
      content.push({ type: "text" as const, text: data.message.content });
    }

    if (data.message.tool_calls) {
      for (const call of data.message.tool_calls) {
        if (
          typeof call.function.arguments !== "object" ||
          call.function.arguments === null ||
          Array.isArray(call.function.arguments)
        ) {
          throw new Error(
            `Invalid tool call arguments for ${call.function.name}: expected object, got ${typeof call.function.arguments}`,
          );
        }
        content.push({
          type: "tool-call",
          id: call.id,
          name: call.function.name,
          parameters: call.function.arguments as Record<string, unknown>,
        });
      }
    }

    const hasToolCalls = content.some((c) => c.type === "tool-call");

    return {
      type: "success",
      id: `ollama-${Date.now()}`,
      model: data.model,
      role: "assistant",
      finishReason: hasToolCalls ? AxleStopReason.FunctionCall : AxleStopReason.Stop,
      content,
      text: getTextContent(content) ?? "",
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
