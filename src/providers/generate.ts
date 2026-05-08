import { AxleAbortError } from "../errors/AxleAbortError.js";
import { AxleToolFatalError } from "../errors/AxleToolFatalError.js";
import type { AxleAssistantMessage, AxleMessage } from "../messages/message.js";
import { getToolCalls } from "../messages/utils.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ExecutableTool, ProviderTool } from "../tools/types.js";
import type { TracingContext } from "../tracer/types.js";
import type { Stats } from "../types.js";
import { throwIfAborted } from "../utils/abort.js";
import type { FileResolver } from "../utils/file.js";
import { generateTurn, GenerateTurnOptions } from "./generateTurn.js";
import {
  appendUsage,
  executeToolCalls,
  GenerateResult,
  resolveToolRegistry,
  ToolCallCallback,
} from "./helpers.js";
import { AIProvider, AxleStopReason, ModelResult } from "./types.js";

export type {
  GenerateError,
  GenerateResult,
  StreamResult,
  ToolCallCallback,
  ToolCallResult,
} from "./helpers.js";

export interface GenerateOptions {
  provider: AIProvider;
  model: string;
  messages: Array<AxleMessage>;
  system?: string;
  tools?: ExecutableTool[];
  providerTools?: ProviderTool[];
  registry?: ToolRegistry;
  onToolCall?: ToolCallCallback;
  maxIterations?: number;
  tracer?: TracingContext;
  fileResolver?: FileResolver;
  options?: GenerateTurnOptions;
  reasoning?: boolean;
  signal?: AbortSignal;
}

export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const {
    provider,
    model,
    messages,
    system,
    onToolCall,
    maxIterations,
    tracer,
    fileResolver,
    options: generateOptions,
    reasoning,
    signal = new AbortController().signal,
  } = options;
  const registry = resolveToolRegistry(options);
  const workingMessages = [...messages];
  const newMessages: AxleMessage[] = [];
  const usage: Stats = { in: 0, out: 0 };

  let iterations = 0;
  let finalMessage: AxleAssistantMessage | undefined;

  const addMessage = (message: AxleMessage) => {
    workingMessages.push(message);
    newMessages.push(message);
  };

  const endWithResult = (result: GenerateResult): GenerateResult => {
    tracer?.setResult({
      kind: "llm",
      model,
      request: { messages },
      response: { content: result.result === "success" ? result.final?.content : null },
      usage: result.usage
        ? { inputTokens: result.usage.in, outputTokens: result.usage.out }
        : undefined,
      finishReason: result.result === "success" ? result.final?.finishReason : undefined,
    });
    tracer?.end(result.result === "error" ? "error" : "ok");
    return result;
  };

  const setTurnResult = (turnSpan: TracingContext | undefined, response: ModelResult): void => {
    if (!turnSpan || response.type === "error") {
      turnSpan?.end("error");
      return;
    }
    turnSpan.setResult({
      kind: "llm",
      model: response.model ?? model,
      request: { messages: workingMessages },
      response: { content: response.content },
      usage: response.usage
        ? { inputTokens: response.usage.in, outputTokens: response.usage.out }
        : undefined,
      finishReason: response.finishReason,
    });
    turnSpan.end();
  };

  try {
    while (true) {
      throwIfAborted(signal, "Generate aborted");

      if (maxIterations !== undefined && iterations >= maxIterations) {
        return endWithResult({
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
        });
      }

      iterations += 1;
      const turnSpan = tracer?.startSpan(`turn-${iterations}`, { type: "llm" });

      const executable = registry.executable();
      const tools =
        executable.length > 0
          ? executable.map((t) => ({ name: t.name, description: t.description, schema: t.schema }))
          : undefined;
      let response: ModelResult;
      try {
        response = await generateTurn({
          provider,
          model,
          messages: workingMessages,
          system,
          tools,
          tracer: turnSpan,
          fileResolver,
          options: generateOptions,
          reasoning,
          signal,
        });

        throwIfAborted(signal, "Generate aborted");
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          turnSpan?.end("ok");
        }
        throw error;
      }

      appendUsage(usage, response);
      setTurnResult(turnSpan, response);

      if (response.type === "error") {
        return endWithResult({
          result: "error",
          messages: newMessages,
          error: { type: "model", error: response },
          usage,
        });
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
        return endWithResult({
          result: "success",
          messages: newMessages,
          final: finalMessage,
          usage,
        });
      }

      const toolCalls = getToolCalls(response.content);
      if (toolCalls.length === 0) {
        return endWithResult({
          result: "success",
          messages: newMessages,
          final: finalMessage,
          usage,
        });
      }

      const { results } = await executeToolCalls(toolCalls, onToolCall, signal, registry, tracer);
      throwIfAborted(signal, "Generate aborted");
      if (results.length > 0) {
        addMessage({ role: "tool", id: crypto.randomUUID(), content: results });
      }
    }
  } catch (error) {
    if (error instanceof AxleToolFatalError) {
      tracer?.end("error");
      throw new AxleToolFatalError(error.message, {
        toolName: error.toolName,
        messages: error.messages ?? newMessages,
        partial: error.partial ?? finalMessage,
        usage: error.usage ?? usage,
        cause: error.cause,
      });
    }
    if (error instanceof AxleAbortError) {
      tracer?.end("ok");
      throw new AxleAbortError("Generate aborted", {
        reason: error.reason,
        messages: error.messages ?? newMessages,
        partial: error.partial,
        usage: error.usage ?? usage,
      });
    }
    if (error instanceof Error && error.name === "AbortError") {
      tracer?.end("ok");
      throw new AxleAbortError("Generate aborted", {
        reason: signal.reason,
        messages: newMessages,
        usage,
      });
    }
    throw error;
  }
}
