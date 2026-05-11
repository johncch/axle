import { Instruct } from "../core/Instruct.js";
import type { OutputSchema } from "../core/parse.js";
import type { InstructResponse } from "../core/userTurn.js";
import { compileUserTurn } from "../core/userTurn.js";
import { AxleAbortError } from "../errors/AxleAbortError.js";
import { AxleToolFatalError } from "../errors/AxleToolFatalError.js";
import type {
  AxleAssistantMessage,
  AxleMessage,
  AxleToolCallMessage,
  ContentPartProviderTool,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
} from "../messages/message.js";
import { ToolRegistry } from "../tools/registry.js";
import type { ExecutableTool, ProviderTool, ToolContext, ToolDefinition } from "../tools/types.js";
import type { LLMResult, TracingContext } from "../tracer/types.js";
import type { Stats } from "../types.js";
import type { FileResolver } from "../utils/file.js";
import type { GenerateTurnOptions } from "./generateTurn.js";
import {
  executeToolCalls,
  type GenerateError,
  resolveToolRegistry,
  type StreamResult,
  type ToolCallCallback,
  type ToolCallResult,
} from "./helpers.js";
import type { AIProvider } from "./types.js";
import { AxleStopReason } from "./types.js";

// --- Public types ---

export type StreamEvent =
  // Message boundaries
  | { type: "turn:start"; id: string; model: string }
  | { type: "turn:complete"; message: AxleAssistantMessage; usage?: Stats }
  | { type: "tool-results:start"; id: string }
  | { type: "tool-results:complete"; message: AxleToolCallMessage }
  // Text streaming
  | { type: "text:start"; index: number }
  | { type: "text:delta"; index: number; delta: string; accumulated: string }
  | { type: "text:end"; index: number; final: string }
  // Thinking streaming
  | { type: "thinking:start"; index: number }
  | { type: "thinking:delta"; index: number; delta: string; accumulated: string }
  | { type: "thinking:end"; index: number; final: string }
  // Tool calls
  | { type: "tool:request"; index: number; id: string; name: string }
  | {
      type: "tool:args-delta";
      index: number;
      id: string;
      name: string;
      delta: string;
      accumulated: string;
    }
  | {
      type: "tool:exec-start";
      index: number;
      id: string;
      name: string;
      parameters: Record<string, unknown>;
    }
  | {
      type: "tool:exec-delta";
      index: number;
      id: string;
      name: string;
      chunk: string;
    }
  | {
      type: "tool:exec-complete";
      index: number;
      id: string;
      name: string;
      result: ToolCallResult;
    }
  // Provider tools (provider-managed: web search, code interpreter, etc.)
  | { type: "provider-tool:start"; index: number; id: string; name: string }
  | { type: "provider-tool:complete"; index: number; id: string; name: string; output?: unknown }
  // Error
  | { type: "error"; error: GenerateError };

export type StreamEventCallback = (event: StreamEvent) => void;

export interface StreamOptions {
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

export interface StreamHandle {
  on(callback: StreamEventCallback): void;
  cancel(reason?: unknown): void;
  readonly final: Promise<StreamResult>;
}

export interface StreamInstructOptions<TSchema extends OutputSchema | undefined> extends Omit<
  StreamOptions,
  "messages"
> {
  messages?: Array<AxleMessage>;
  instruct: Instruct<TSchema>;
}

export type StreamInstructResult<TSchema extends OutputSchema | undefined> =
  | (Extract<StreamResult, { result: "success" }> & {
      response: InstructResponse<TSchema> | null;
      parseError?: unknown;
    })
  | Extract<StreamResult, { result: "error" }>;

export interface StreamInstructHandle<TSchema extends OutputSchema | undefined> extends Omit<
  StreamHandle,
  "final"
> {
  readonly final: Promise<StreamInstructResult<TSchema>>;
}

// --- Implementation ---

function emit(callbacks: StreamEventCallback[], event: StreamEvent) {
  for (const cb of callbacks) cb(event);
}

function makeNotFoundToolResult(name: string): ToolCallResult {
  return {
    type: "error",
    error: {
      type: "not-found",
      message: `Tool not found: ${name}`,
    },
  };
}

function toToolDefinition(tool: ExecutableTool): ToolDefinition {
  return { name: tool.name, description: tool.description, schema: tool.schema };
}

export function stream<TSchema extends OutputSchema | undefined>(
  options: StreamInstructOptions<TSchema>,
): StreamInstructHandle<TSchema>;
export function stream(options: StreamOptions): StreamHandle;
export function stream(options: StreamOptions | StreamInstructOptions<any>): StreamHandle {
  const callbacks: StreamEventCallback[] = [];
  let streamOptions: StreamOptions;
  let parse: ((final: AxleAssistantMessage | undefined) => unknown) | undefined;

  if ("instruct" in options) {
    const { instruct, messages, ...rest } = options;
    const userTurn = compileUserTurn(instruct);
    parse = userTurn.parse;
    streamOptions = {
      ...rest,
      messages: [...(messages ?? []), userTurn.message],
    };
  } else {
    streamOptions = options;
  }

  const controller = new AbortController();
  const effectiveSignal = streamOptions.signal
    ? AbortSignal.any([controller.signal, streamOptions.signal])
    : controller.signal;

  const { promise: finalPromise, resolve, reject } = Promise.withResolvers<any>();

  // Kick off processing on next microtask so callers can register callbacks first
  Promise.resolve().then(() =>
    run(streamOptions, effectiveSignal, callbacks).then((result) => {
      if (parse && result.result === "success") {
        try {
          resolve({ ...result, response: parse(result.final) });
        } catch (parseError) {
          resolve({ ...result, response: null, parseError });
        }
        return;
      }
      resolve(result);
    }, reject),
  );

  return {
    on(cb) {
      callbacks.push(cb);
    },
    cancel(reason?: unknown) {
      controller.abort(reason);
    },
    get final() {
      return finalPromise;
    },
  };
}

// --- Core loop ---

async function run(
  options: StreamOptions,
  signal: AbortSignal,
  cbs: StreamEventCallback[],
): Promise<StreamResult> {
  const {
    provider,
    model,
    messages,
    system,
    onToolCall,
    maxIterations,
    tracer,
    fileResolver,
    options: genOptions,
    reasoning,
  } = options;
  const registry = resolveToolRegistry(options);
  const workingMessages = [...messages];
  const newMessages: AxleMessage[] = [];
  const usage: Stats = { in: 0, out: 0 };
  let globalIndex = 0;
  let iterations = 0;

  const addMessage = (message: AxleMessage) => {
    workingMessages.push(message);
    newMessages.push(message);
  };

  const endWithResult = (result: StreamResult): StreamResult => {
    if (result.result === "error") {
      emit(cbs, { type: "error", error: result.error });
    }
    const finalContent = result.result === "success" ? result.final?.content : null;
    const finishReason = result.result === "success" ? result.final?.finishReason : undefined;
    tracer?.setResult({
      kind: "llm",
      model,
      request: { messages },
      response: { content: finalContent ?? null },
      usage: result.usage
        ? { inputTokens: result.usage.in, outputTokens: result.usage.out }
        : undefined,
      finishReason,
    });
    tracer?.end(result.result === "error" ? "error" : "ok");
    return result;
  };

  const throwAbortError = (
    turnParts: Array<
      ContentPartText | ContentPartThinking | ContentPartToolCall | ContentPartProviderTool
    >,
    turnId: string,
    turnModel: string | undefined,
    closePart: () => void,
  ): never => {
    closePart();
    const partial = turnParts.length
      ? {
          role: "assistant" as const,
          id: turnId,
          model: turnModel,
          content: turnParts,
          finishReason: AxleStopReason.Cancelled,
        }
      : undefined;
    if (partial) addMessage(partial);
    tracer?.end("ok");
    throw new AxleAbortError("Stream aborted", {
      reason: signal.reason,
      messages: newMessages,
      partial,
      usage,
    });
  };

  while (true) {
    // Check 1: before starting a new iteration
    if (signal.aborted) {
      throwAbortError([], "", "", () => {});
    }

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

    const executable = registry?.executable() ?? [];
    const tools = executable.length > 0 ? executable.map(toToolDefinition) : undefined;
    const providerTools = registry?.provider() ?? [];
    const mergedOptions = providerTools.length > 0 ? { ...genOptions, providerTools } : genOptions;

    const streamSource = provider.createStreamingRequest(model, {
      messages: workingMessages,
      system,
      tools,
      context: { tracer: turnSpan, fileResolver },
      signal,
      options: mergedOptions,
      reasoning,
    });

    const turnParts: Array<
      ContentPartText | ContentPartThinking | ContentPartToolCall | ContentPartProviderTool
    > = [];
    let turnId = "";
    let turnModel = "";
    let turnFinishReason: AxleStopReason | null = null;
    let turnUsage: Stats = { in: 0, out: 0 };

    // Track the current "open" part for accumulation
    let openPartIndex = -1;
    let openPartType: "text" | "thinking" | null = null;
    let openAccumulated: string = "";

    // Track tool call id → globalIndex for tool execution events
    const toolCallIndexMap = new Map<string, number>();

    // Index of the most recently pushed turnParts entry.
    // Provider block indices can have gaps (e.g. web_search_tool_result), but
    // blocks stream sequentially so the current part is always the last pushed.
    let currentPartIndex = -1;

    const closePart = () => {
      if (openPartType !== null && openPartIndex >= 0) {
        const endType = openPartType === "text" ? ("text:end" as const) : ("thinking:end" as const);
        emit(cbs, { type: endType, index: openPartIndex, final: openAccumulated });
        openPartType = null;
        openAccumulated = "";
        openPartIndex = -1;
      }
    };

    for await (const chunk of streamSource) {
      switch (chunk.type) {
        case "start":
          turnId = chunk.id;
          turnModel = chunk.data.model;
          emit(cbs, { type: "turn:start", id: turnId, model: turnModel });
          break;

        case "text-start": {
          closePart();
          turnParts.push({ type: "text", text: "" });
          currentPartIndex = turnParts.length - 1;
          openPartIndex = globalIndex++;
          openPartType = "text";
          openAccumulated = "";
          emit(cbs, { type: "text:start", index: openPartIndex });
          break;
        }

        case "text-delta": {
          const part = turnParts[currentPartIndex] as ContentPartText;
          part.text += chunk.data.text;
          openAccumulated = part.text;
          emit(cbs, {
            type: "text:delta",
            index: openPartIndex,
            delta: chunk.data.text,
            accumulated: openAccumulated,
          });
          break;
        }

        case "text-complete": {
          closePart();
          break;
        }

        case "thinking-start": {
          closePart();
          turnParts.push({ type: "thinking", text: "" });
          currentPartIndex = turnParts.length - 1;
          openPartIndex = globalIndex++;
          openPartType = "thinking";
          openAccumulated = "";
          emit(cbs, { type: "thinking:start", index: openPartIndex });
          break;
        }

        case "thinking-delta": {
          const part = turnParts[currentPartIndex] as ContentPartThinking;
          part.text += chunk.data.text;
          openAccumulated = part.text;
          emit(cbs, {
            type: "thinking:delta",
            index: openPartIndex,
            delta: chunk.data.text,
            accumulated: openAccumulated,
          });
          break;
        }

        case "thinking-summary-delta": {
          const part = turnParts[currentPartIndex] as ContentPartThinking;
          part.text += chunk.data.text;
          openAccumulated = part.text;
          emit(cbs, {
            type: "thinking:delta",
            index: openPartIndex,
            delta: chunk.data.text,
            accumulated: openAccumulated,
          });
          break;
        }

        case "thinking-complete": {
          closePart();
          break;
        }

        case "tool-call-start": {
          closePart();
          const idx = globalIndex++;
          turnParts.push({
            type: "tool-call",
            id: chunk.data.id,
            name: chunk.data.name,
            parameters: {},
          });
          currentPartIndex = turnParts.length - 1;
          toolCallIndexMap.set(chunk.data.id, idx);
          emit(cbs, { type: "tool:request", index: idx, id: chunk.data.id, name: chunk.data.name });
          break;
        }

        case "tool-call-args-delta": {
          const idx = toolCallIndexMap.get(chunk.data.id) ?? -1;
          emit(cbs, {
            type: "tool:args-delta",
            index: idx,
            id: chunk.data.id,
            name: chunk.data.name,
            delta: chunk.data.delta,
            accumulated: chunk.data.accumulated,
          });
          break;
        }

        case "tool-call-complete": {
          const part = turnParts[currentPartIndex] as ContentPartToolCall;
          if (chunk.data.id) part.id = chunk.data.id;
          if (chunk.data.name) part.name = chunk.data.name;
          part.parameters = chunk.data.arguments;
          if (chunk.data.providerMetadata) part.providerMetadata = chunk.data.providerMetadata;
          break;
        }

        case "provider-tool-start": {
          closePart();
          const idx = globalIndex++;
          turnParts.push({
            type: "provider-tool",
            id: chunk.data.id,
            name: chunk.data.name,
          });
          currentPartIndex = turnParts.length - 1;
          emit(cbs, {
            type: "provider-tool:start",
            index: idx,
            id: chunk.data.id,
            name: chunk.data.name,
          });
          break;
        }

        case "provider-tool-complete": {
          const part = turnParts[currentPartIndex] as ContentPartProviderTool;
          if (chunk.data.output != null) part.output = chunk.data.output;
          emit(cbs, {
            type: "provider-tool:complete",
            index: chunk.data.index,
            id: chunk.data.id,
            name: chunk.data.name,
            output: chunk.data.output,
          });
          break;
        }

        case "complete": {
          closePart();
          turnFinishReason = chunk.data.finishReason;
          turnUsage = chunk.data.usage;
          break;
        }

        case "error": {
          closePart();
          const errorUsage = chunk.data.usage ?? { in: 0, out: 0 };
          usage.in += errorUsage.in ?? 0;
          usage.out += errorUsage.out ?? 0;
          turnSpan?.end("error");
          return endWithResult({
            result: "error",
            messages: newMessages,
            error: {
              type: "model",
              error: {
                type: "error",
                error: { type: chunk.data.type, message: chunk.data.message },
              },
            },
            usage,
          });
        }

        default:
          console.warn(`[WARN] Unhandled chunk type. Should never happen`);
      }

      // Check 2: after processing each chunk
      if (signal.aborted) break;
    }

    if (signal.aborted) {
      turnSpan?.end("ok");
      throwAbortError(turnParts, turnId, turnModel, closePart);
    }

    // Stream ended without a complete chunk — connection dropped or provider bug
    if (turnFinishReason === null) {
      closePart();
      turnSpan?.end("error");
      return endWithResult({
        result: "error",
        messages: newMessages,
        error: {
          type: "model",
          error: {
            type: "error",
            error: {
              type: "IncompleteStream",
              message: "Stream ended without a completion signal",
            },
          },
        },
        usage,
      });
    }

    usage.in += turnUsage.in ?? 0;
    usage.out += turnUsage.out ?? 0;

    const turnLLMResult: LLMResult = {
      kind: "llm",
      model: turnModel,
      request: { messages: workingMessages },
      response: { content: turnParts },
      usage: { inputTokens: turnUsage.in, outputTokens: turnUsage.out },
      finishReason: turnFinishReason,
    };
    turnSpan?.setResult(turnLLMResult);
    turnSpan?.end();

    // Build and add assistant message
    const assistantMessage: AxleAssistantMessage = {
      role: "assistant",
      id: turnId,
      model: turnModel,
      content: turnParts,
      finishReason: turnFinishReason,
    };
    addMessage(assistantMessage);
    emit(cbs, { type: "turn:complete", message: assistantMessage, usage: turnUsage });

    // If not a function call, we're done
    if (turnFinishReason !== AxleStopReason.FunctionCall) {
      return endWithResult({
        result: "success",
        messages: newMessages,
        final: assistantMessage,
        usage,
      });
    }

    // Extract tool calls from the turn's parts
    const toolCalls = turnParts.filter((p): p is ContentPartToolCall => p.type === "tool-call");
    if (toolCalls.length === 0) {
      return endWithResult({
        result: "success",
        messages: newMessages,
        final: assistantMessage,
        usage,
      });
    }

    // Check 3: before tool execution
    if (signal.aborted) {
      tracer?.end("ok");
      throw new AxleAbortError("Stream aborted", {
        reason: signal.reason,
        messages: newMessages,
        usage,
      });
    }

    const toolResultsId = crypto.randomUUID();
    emit(cbs, { type: "tool-results:start", id: toolResultsId });

    let toolExecIndex = 0;
    const emittingToolCall: ToolCallCallback = async (name, parameters, ctx) => {
      const call = toolCalls[toolExecIndex++];
      const idx = toolCallIndexMap.get(call.id) ?? -1;

      emit(cbs, { type: "tool:exec-start", index: idx, id: call.id, name, parameters });

      const wrappedCtx: ToolContext = {
        ...ctx,
        emit: (chunk: string) => {
          emit(cbs, { type: "tool:exec-delta", index: idx, id: call.id, name, chunk });
        },
      };

      const rawResult = onToolCall ? await onToolCall(name, parameters, wrappedCtx) : null;
      const result = rawResult ?? makeNotFoundToolResult(name);

      emit(cbs, {
        type: "tool:exec-complete",
        index: idx,
        id: call.id,
        name,
        result,
      });

      return result;
    };

    let results;
    try {
      ({ results } = await executeToolCalls(toolCalls, emittingToolCall, signal, registry, tracer));
    } catch (error) {
      if (error instanceof AxleToolFatalError) {
        tracer?.end("error");
        throw new AxleToolFatalError(error.message, {
          toolName: error.toolName,
          messages: error.messages ?? newMessages,
          partial: error.partial ?? assistantMessage,
          usage: error.usage ?? usage,
          cause: error.cause,
        });
      }
      if (error instanceof AxleAbortError) {
        tracer?.end("ok");
        throw new AxleAbortError("Stream aborted", {
          reason: error.reason,
          messages: error.messages ?? newMessages,
          partial: error.partial,
          usage: error.usage ?? usage,
        });
      }
      throw error;
    }

    if (results.length > 0) {
      const toolResultsMessage: AxleToolCallMessage = {
        role: "tool",
        id: toolResultsId,
        content: results,
      };
      addMessage(toolResultsMessage);
      emit(cbs, { type: "tool-results:complete", message: toolResultsMessage });
    }
  }
}
