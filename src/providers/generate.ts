import type {
  AxleAssistantMessage,
  AxleMessage,
  AxleToolCallResult,
  ContentPartToolCall,
} from "../messages/types.js";
import { getToolCalls } from "../messages/utils.js";
import type { ToolDefinition } from "../tools/types.js";
import type { TracingContext } from "../tracer/types.js";
import type { Stats } from "../types.js";
import { GenerateOptions, generateTurn } from "./generateTurn.js";
import { AIProvider, AxleStopReason, ModelError, ModelResult } from "./types.js";

export type ToolCallResult =
  | { type: "success"; content: string }
  | {
      type: "error";
      error: { type: string; message: string; fatal?: boolean; retryable?: boolean };
    };

export type GenerateWithToolsError =
  | { type: "model"; error: ModelError }
  | { type: "tool"; error: { name: string; message: string } };

export type GenerateWithToolsResult =
  | {
      result: "success";
      messages: AxleMessage[];
      final?: AxleAssistantMessage;
      usage?: Stats;
    }
  | {
      result: "error";
      messages: AxleMessage[];
      error: GenerateWithToolsError;
      usage?: Stats;
    };

export interface GenerateWithToolsOptions {
  provider: AIProvider;
  messages: Array<AxleMessage>;
  system?: string;
  tools?: Array<ToolDefinition>;
  onToolCall: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<ToolCallResult | null | undefined>;
  maxIterations?: number;
  tracer?: TracingContext;
  options?: GenerateOptions;
}

function appendUsage(total: Stats, result: ModelResult): void {
  const usage = result.usage ?? { in: 0, out: 0 };
  total.in += usage.in ?? 0;
  total.out += usage.out ?? 0;
}

function serializeToolError(error: { type: string; message: string }): string {
  return JSON.stringify({ error });
}

async function executeToolCalls(
  toolCalls: ContentPartToolCall[],
  onToolCall: GenerateWithToolsOptions["onToolCall"],
): Promise<{
  results: AxleToolCallResult[];
  missingTool?: { name: string; message: string };
}> {
  const results: AxleToolCallResult[] = [];
  let missingTool: { name: string; message: string } | undefined;

  for (const call of toolCalls) {
    let resolved: ToolCallResult | null | undefined;

    try {
      resolved = await onToolCall(call.name, call.parameters);
    } catch (error) {
      resolved = {
        type: "error",
        error: {
          type: "exception",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }

    if (resolved == null) {
      missingTool = {
        name: call.name,
        message: `Tool not found: ${call.name}`,
      };
      results.push({
        id: call.id,
        name: call.name,
        content: serializeToolError({ type: "not-found", message: missingTool.message }),
      });
      break;
    }

    if (resolved.type === "success") {
      results.push({
        id: call.id,
        name: call.name,
        content: resolved.content,
      });
    } else {
      results.push({
        id: call.id,
        name: call.name,
        content: serializeToolError(resolved.error),
      });
    }
  }

  return { results, missingTool };
}

export async function generate(
  options: GenerateWithToolsOptions,
): Promise<GenerateWithToolsResult> {
  const {
    provider,
    messages,
    system,
    tools,
    onToolCall,
    maxIterations,
    tracer,
    options: generateOptions,
  } = options;
  const workingMessages = [...messages];
  const newMessages: AxleMessage[] = [];
  const usage: Stats = { in: 0, out: 0 };

  let iterations = 0;
  let finalMessage: AxleAssistantMessage | undefined;

  const addMessage = (message: AxleMessage) => {
    workingMessages.push(message);
    newMessages.push(message);
  };

  while (true) {
    if (maxIterations !== undefined && iterations >= maxIterations) {
      return {
        result: "error",
        messages: newMessages,
        error: {
          type: "model",
          error: {
            type: "error",
            error: {
              type: "MaxIterations",
              message: `Exceeded max iterations (${maxIterations})`,
            },
          },
        },
        usage,
      };
    }

    iterations += 1;
    const response = await generateTurn({
      provider,
      messages: workingMessages,
      system,
      tools,
      tracer,
      options: generateOptions,
    });

    appendUsage(usage, response);

    if (response.type === "error") {
      return {
        result: "error",
        messages: newMessages,
        error: { type: "model", error: response },
        usage,
      };
    }

    const assistantMessage: AxleAssistantMessage = {
      role: "assistant",
      id: response.id,
      model: response.model,
      content: response.content,
      finishReason: response.finishReason,
    };
    addMessage(assistantMessage);
    finalMessage = assistantMessage;

    if (response.finishReason !== AxleStopReason.FunctionCall) {
      return {
        result: "success",
        messages: newMessages,
        final: finalMessage,
        usage,
      };
    }

    const toolCalls = getToolCalls(response.content);
    if (toolCalls.length === 0) {
      return {
        result: "success",
        messages: newMessages,
        final: finalMessage,
        usage,
      };
    }

    const { results, missingTool } = await executeToolCalls(toolCalls, onToolCall);
    if (results.length > 0) {
      addMessage({ role: "tool", content: results });
    }

    if (missingTool) {
      return {
        result: "error",
        messages: newMessages,
        error: { type: "tool", error: missingTool },
        usage,
      };
    }
  }
}
