import { AxleAbortError } from "../errors/AxleAbortError.js";
import { AxleError } from "../errors/AxleError.js";
import { AxleToolFatalError } from "../errors/AxleToolFatalError.js";
import type {
  AxleAssistantMessage,
  AxleMessage,
  AxleToolCallResult,
  ContentPartToolCall,
  ToolResultPart,
} from "../messages/message.js";
import { ToolRegistry } from "../tools/registry.js";
import type { ExecutableTool, ProviderTool, ToolContext } from "../tools/types.js";
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
  ctx: ToolContext,
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

export type StreamResult = GenerateResult;

export function appendUsage(total: Stats, result: ModelResult): void {
  const usage = result.usage ?? { in: 0, out: 0 };
  total.in += usage.in ?? 0;
  total.out += usage.out ?? 0;
}

export function serializeToolError(error: { type: string; message: string }): string {
  return JSON.stringify({ error });
}

export function resolveToolRegistry(options: {
  registry?: ToolRegistry;
  tools?: ExecutableTool[];
  providerTools?: ProviderTool[];
}): ToolRegistry {
  const hasShortcut = options.tools !== undefined || options.providerTools !== undefined;
  if (options.registry && hasShortcut) {
    throw new AxleError(
      "Cannot specify both `registry` and `tools` / `providerTools`. Use one or the other.",
      { code: "TOOL_OPTIONS_CONFLICT" },
    );
  }
  if (options.registry) return options.registry;
  return new ToolRegistry({ tools: options.tools, providerTools: options.providerTools });
}

export async function executeToolCalls(
  toolCalls: ContentPartToolCall[],
  onToolCall: ToolCallCallback = async () => null,
  signal: AbortSignal,
  registry: ToolRegistry,
  tracer?: TracingContext,
): Promise<{ results: AxleToolCallResult[] }> {
  const results: AxleToolCallResult[] = [];

  const throwAbortError = (): never => {
    throw new AxleAbortError("Operation aborted", { reason: signal.reason });
  };

  for (const call of toolCalls) {
    if (signal.aborted) {
      throwAbortError();
    }
    const span = tracer?.startSpan(call.name, { type: "tool" });
    const ctx: ToolContext = { signal, tracer: span, registry, emit: () => {} };
    let resolved: ToolCallResult | null | undefined;

    try {
      resolved = await onToolCall(call.name, call.parameters, ctx);
      if (signal.aborted) {
        span?.end("ok");
        throwAbortError();
      }
    } catch (error) {
      if (error instanceof AxleToolFatalError) {
        span?.setResult({
          kind: "tool",
          name: call.name,
          input: call.parameters,
          output: { type: "fatal", message: error.message },
        });
        span?.end("error");
        throw error;
      }
      if (
        signal.aborted ||
        error instanceof AxleAbortError ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        span?.end("ok");
        throwAbortError();
      }
      resolved = {
        type: "error",
        error: {
          type: "exception",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }

    if (resolved == null) {
      const tool = registry.get(call.name);
      if (tool) {
        try {
          const content = await tool.execute(call.parameters, ctx);
          span?.setResult({
            kind: "tool",
            name: call.name,
            input: call.parameters,
            output: content,
          });
          span?.end("ok");
          results.push({
            id: call.id,
            name: call.name,
            content,
          });
          continue;
        } catch (error) {
          if (error instanceof AxleToolFatalError) {
            span?.setResult({
              kind: "tool",
              name: call.name,
              input: call.parameters,
              output: { type: "fatal", message: error.message },
            });
            span?.end("error");
            throw error;
          }
          if (
            signal.aborted ||
            error instanceof AxleAbortError ||
            (error instanceof Error && error.name === "AbortError")
          ) {
            span?.end("ok");
            throwAbortError();
          }
          resolved = {
            type: "error",
            error: {
              type: "execution",
              message: error instanceof Error ? error.message : String(error),
            },
          };
        }
      }
    }

    if (resolved == null) {
      const message = `Tool not found: ${call.name}`;
      span?.setResult({
        kind: "tool",
        name: call.name,
        input: call.parameters,
        output: { type: "not-found", message },
      });
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
