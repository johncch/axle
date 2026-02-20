import type {
  AxleAssistantMessage,
  AxleMessage,
  AxleToolCallResult,
  ContentPartToolCall,
  ToolResultPart,
} from "../messages/message.js";
import type { Stats } from "../types.js";
import type { ModelError, ModelResult } from "./types.js";

export type ToolCallResult =
  | { type: "success"; content: string | ToolResultPart[] }
  | {
      type: "error";
      error: { type: string; message: string; fatal?: boolean; retryable?: boolean };
    };

export type ToolCallCallback = (
  name: string,
  parameters: Record<string, unknown>,
) => Promise<ToolCallResult | null | undefined>;

export type GenerateError =
  | { type: "model"; error: ModelError }
  | { type: "tool"; error: { name: string; message: string } };

export type GenerateResult =
  | {
      result: "success";
      messages: AxleMessage[];
      final?: AxleAssistantMessage;
      usage?: Stats;
    }
  | {
      result: "error";
      messages: AxleMessage[];
      error: GenerateError;
      usage?: Stats;
    };

export type StreamResult =
  | GenerateResult
  | {
      result: "cancelled";
      messages: AxleMessage[];
      partial?: AxleAssistantMessage;
      usage: Stats;
    };

export function appendUsage(total: Stats, result: ModelResult): void {
  const usage = result.usage ?? { in: 0, out: 0 };
  total.in += usage.in ?? 0;
  total.out += usage.out ?? 0;
}

export function serializeToolError(error: { type: string; message: string }): string {
  return JSON.stringify({ error });
}

export async function executeToolCalls(
  toolCalls: ContentPartToolCall[],
  onToolCall: ToolCallCallback,
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
