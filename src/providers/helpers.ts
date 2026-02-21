import type {
  AxleAssistantMessage,
  AxleMessage,
  AxleToolCallResult,
  ContentPartToolCall,
  ToolResultPart,
} from "../messages/message.js";
import type { TracingContext } from "../tracer/types.js";
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
  onToolCall: ToolCallCallback = async () => null,
  tracer?: TracingContext,
): Promise<{ results: AxleToolCallResult[] }> {
  const results: AxleToolCallResult[] = [];

  for (const call of toolCalls) {
    const span = tracer?.startSpan(call.name, { type: "tool" });
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
      const message = `Tool not found: ${call.name}`;
      span?.setResult({ kind: "tool", name: call.name, input: call.parameters, output: null });
      span?.end("error");
      results.push({
        id: call.id,
        name: call.name,
        content: serializeToolError({ type: "not-found", message }),
        isError: true,
      });
      continue;
    }

    if (resolved.type === "success") {
      span?.setResult({
        kind: "tool",
        name: call.name,
        input: call.parameters,
        output: resolved.content,
      });
      span?.end("ok");
      results.push({
        id: call.id,
        name: call.name,
        content: resolved.content,
      });
    } else {
      span?.setResult({
        kind: "tool",
        name: call.name,
        input: call.parameters,
        output: resolved.error,
      });
      span?.end("error");
      results.push({
        id: call.id,
        name: call.name,
        content: serializeToolError(resolved.error),
        isError: true,
      });
    }
  }

  return { results };
}
