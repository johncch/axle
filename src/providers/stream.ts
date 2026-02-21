import type {
  AxleAssistantMessage,
  AxleMessage,
  ContentPartInternalTool,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
} from "../messages/message.js";
import type { ServerTool, ToolDefinition } from "../tools/types.js";
import type { LLMResult, TracingContext } from "../tracer/types.js";
import type { Stats } from "../types.js";
import type { GenerateTurnOptions } from "./generateTurn.js";
import {
  executeToolCalls,
  type GenerateError,
  type StreamResult,
  type ToolCallCallback,
  type ToolCallResult,
} from "./helpers.js";
import type { AIProvider } from "./types.js";
import { AxleStopReason } from "./types.js";

// --- Public types ---

export type StreamEvent =
  // Text streaming
  | { type: "text:start"; index: number }
  | { type: "text:delta"; index: number; delta: string; accumulated: string }
  | { type: "text:end"; index: number; final: string }
  // Thinking streaming
  | { type: "thinking:start"; index: number }
  | { type: "thinking:delta"; index: number; delta: string; accumulated: string }
  | { type: "thinking:end"; index: number; final: string }
  // Tool calls
  | { type: "tool:start"; index: number; id: string; name: string }
  | { type: "tool:execute"; index: number; id: string; name: string; parameters: Record<string, unknown> }
  | { type: "tool:complete"; index: number; id: string; name: string; result: ToolCallResult | null }
  // Internal tools (provider-managed: web search, code interpreter, etc.)
  | { type: "internal-tool:start"; index: number; id: string; name: string }
  | { type: "internal-tool:complete"; index: number; id: string; name: string; output?: unknown }
  // Error
  | { type: "error"; error: GenerateError };

export type StreamEventCallback = (event: StreamEvent) => void;

export interface StreamOptions {
  provider: AIProvider;
  model: string;
  messages: Array<AxleMessage>;
  system?: string;
  tools?: Array<ToolDefinition>;
  serverTools?: Array<ServerTool>;
  onToolCall?: ToolCallCallback;
  maxIterations?: number;
  tracer?: TracingContext;
  options?: GenerateTurnOptions;
}

export interface StreamHandle {
  on(callback: StreamEventCallback): void;
  cancel(): void;
  readonly final: Promise<StreamResult>;
}

// --- Implementation ---

function emit(callbacks: StreamEventCallback[], event: StreamEvent) {
  for (const cb of callbacks) cb(event);
}

export function stream(options: StreamOptions): StreamHandle {
  const callbacks: StreamEventCallback[] = [];

  const controller = new AbortController();
  let settled = false;

  let resolveResult: (r: StreamResult) => void;
  let rejectResult: (e: unknown) => void;
  const finalPromise = new Promise<StreamResult>((resolve, reject) => {
    resolveResult = (r) => {
      settled = true;
      resolve(r);
    };
    rejectResult = (e) => {
      settled = true;
      reject(e);
    };
  });

  // Kick off processing on next microtask so callers can register callbacks first
  Promise.resolve().then(() =>
    run(options, controller.signal, callbacks).then(resolveResult!, rejectResult!),
  );

  return {
    on(cb) {
      callbacks.push(cb);
    },
    cancel() {
      if (!settled) controller.abort();
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
    tools,
    serverTools,
    onToolCall,
    maxIterations,
    tracer,
    options: genOptions,
  } = options;
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
    const finalContent =
      result.result === "success"
        ? result.final?.content
        : result.result === "cancelled"
          ? result.partial?.content
          : null;
    const finishReason =
      result.result === "success"
        ? result.final?.finishReason
        : result.result === "cancelled"
          ? AxleStopReason.Cancelled
          : undefined;
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

  const buildCancelledResult = (
    turnParts: Array<
      ContentPartText | ContentPartThinking | ContentPartToolCall | ContentPartInternalTool
    >,
    turnId: string,
    turnModel: string,
    closePart: () => void,
  ): StreamResult => {
    closePart();
    const hasContent = turnParts.length > 0;
    const partial: AxleAssistantMessage | undefined = hasContent
      ? {
          role: "assistant",
          id: turnId,
          model: turnModel,
          content: turnParts,
          finishReason: AxleStopReason.Cancelled,
        }
      : undefined;
    if (partial) addMessage(partial);
    tracer?.end("ok");
    return { result: "cancelled", messages: newMessages, partial, usage };
  };

  while (true) {
    // Check 1: before starting a new iteration
    if (signal.aborted) {
      return buildCancelledResult([], "", "", () => {});
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
    turnSpan?.startLLMStream();

    const mergedOptions = serverTools
      ? { ...genOptions, serverTools }
      : genOptions;

    const streamSource = provider.createStreamingRequest?.(model, {
      messages: workingMessages,
      system,
      tools,
      context: { tracer: turnSpan },
      signal,
      options: mergedOptions,
    });

    if (!streamSource) {
      turnSpan?.end("error");
      throw new Error("Provider does not support streaming. Use generate() instead.");
    }

    const turnParts: Array<
      ContentPartText | ContentPartThinking | ContentPartToolCall | ContentPartInternalTool
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
          turnSpan?.appendLLMStream(chunk.data.text);
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
          emit(cbs, { type: "tool:start", index: idx, id: chunk.data.id, name: chunk.data.name });
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

        case "internal-tool-start": {
          closePart();
          const idx = globalIndex++;
          turnParts.push({
            type: "internal-tool",
            id: chunk.data.id,
            name: chunk.data.name,
          });
          currentPartIndex = turnParts.length - 1;
          emit(cbs, {
            type: "internal-tool:start",
            index: idx,
            id: chunk.data.id,
            name: chunk.data.name,
          });
          break;
        }

        case "internal-tool-complete": {
          const part = turnParts[currentPartIndex] as ContentPartInternalTool;
          if (chunk.data.output != null) part.output = chunk.data.output;
          emit(cbs, {
            type: "internal-tool:complete",
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
      return buildCancelledResult(turnParts, turnId, turnModel, closePart);
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
    turnSpan?.endLLMStream(turnLLMResult);
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
      return { result: "cancelled", messages: newMessages, usage };
    }

    const wrappedToolCall = onToolCall
      ? async (name: string, parameters: Record<string, unknown>) => {
          return onToolCall(name, parameters);
        }
      : async () => null as ToolCallResult | null;

    let toolExecIndex = 0;
    const emittingToolCall: ToolCallCallback = async (name, parameters) => {
      const call = toolCalls[toolExecIndex++];
      const idx = toolCallIndexMap.get(call.id) ?? -1;
      emit(cbs, { type: "tool:execute", index: idx, id: call.id, name, parameters });
      const result = await wrappedToolCall(name, parameters);
      emit(cbs, { type: "tool:complete", index: idx, id: call.id, name, result: result ?? null });
      return result;
    };

    const { results, missingTool } = await executeToolCalls(toolCalls, emittingToolCall, tracer);

    if (results.length > 0) {
      addMessage({ role: "tool", content: results });
    }

    if (missingTool) {
      return endWithResult({
        result: "error",
        messages: newMessages,
        error: { type: "tool", error: missingTool },
        usage,
      });
    }
  }
}
