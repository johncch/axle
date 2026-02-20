import type {
  AxleAssistantMessage,
  AxleMessage,
  ContentPartInternalTool,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
} from "../messages/message.js";
import type { ToolDefinition } from "../tools/types.js";
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

export type StreamPartType = "text" | "thinking";

export type PartStartCallback = (index: number, type: StreamPartType) => void;

export type PartUpdateCallback = (
  index: number,
  type: StreamPartType,
  delta: string,
  accumulated: string,
) => void;

export type PartEndCallback = (index: number, type: StreamPartType, final: string) => void;

export type InternalToolEvent =
  | { type: "start"; index: number; id: string; name: string }
  | { type: "complete"; index: number; id: string; name: string; output?: unknown };

export type InternalToolCallback = (event: InternalToolEvent) => void;

export type ErrorCallback = (error: GenerateError) => void;

export interface StreamOptions {
  provider: AIProvider;
  model: string;
  messages: Array<AxleMessage>;
  system?: string;
  tools?: Array<ToolDefinition>;
  onToolCall?: ToolCallCallback;
  maxIterations?: number;
  tracer?: TracingContext;
  options?: GenerateTurnOptions;
}

export interface StreamHandle {
  onPartStart(callback: PartStartCallback): void;
  onPartUpdate(callback: PartUpdateCallback): void;
  onPartEnd(callback: PartEndCallback): void;
  onInternalTool(callback: InternalToolCallback): void;
  onError(callback: ErrorCallback): void;
  cancel(): void;
  readonly final: Promise<StreamResult>;
}

// --- Implementation ---

export function stream(options: StreamOptions): StreamHandle {
  const partStartCallbacks: PartStartCallback[] = [];
  const partUpdateCallbacks: PartUpdateCallback[] = [];
  const partEndCallbacks: PartEndCallback[] = [];
  const internalToolCallbacks: InternalToolCallback[] = [];
  const errorCallbacks: ErrorCallback[] = [];

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
    run(
      options,
      controller.signal,
      partStartCallbacks,
      partUpdateCallbacks,
      partEndCallbacks,
      internalToolCallbacks,
      errorCallbacks,
    ).then(resolveResult!, rejectResult!),
  );

  return {
    onPartStart(cb) {
      partStartCallbacks.push(cb);
    },
    onPartUpdate(cb) {
      partUpdateCallbacks.push(cb);
    },
    onPartEnd(cb) {
      partEndCallbacks.push(cb);
    },
    onInternalTool(cb) {
      internalToolCallbacks.push(cb);
    },
    onError(cb) {
      errorCallbacks.push(cb);
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

function emitPartStart(callbacks: PartStartCallback[], index: number, type: StreamPartType) {
  for (const cb of callbacks) cb(index, type);
}

function emitPartUpdate(
  callbacks: PartUpdateCallback[],
  index: number,
  type: StreamPartType,
  delta: string,
  accumulated: string,
) {
  for (const cb of callbacks) cb(index, type, delta, accumulated);
}

function emitPartEnd(
  callbacks: PartEndCallback[],
  index: number,
  type: StreamPartType,
  final: string,
) {
  for (const cb of callbacks) cb(index, type, final);
}

function emitError(callbacks: ErrorCallback[], error: GenerateError) {
  for (const cb of callbacks) cb(error);
}

async function run(
  options: StreamOptions,
  signal: AbortSignal,
  startCbs: PartStartCallback[],
  updateCbs: PartUpdateCallback[],
  partEndCbs: PartEndCallback[],
  internalToolCbs: InternalToolCallback[],
  errorCbs: ErrorCallback[],
): Promise<StreamResult> {
  const {
    provider,
    model,
    messages,
    system,
    tools,
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
      emitError(errorCbs, result.error);
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

    const streamSource = provider.createStreamingRequest?.(model, {
      messages: workingMessages,
      system,
      tools,
      context: { tracer: turnSpan },
      signal,
      options: genOptions,
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
    let openPartType: StreamPartType | null = null;
    let openAccumulated: string = "";

    const closePart = () => {
      if (openPartType !== null && openPartIndex >= 0) {
        emitPartEnd(partEndCbs, openPartIndex, openPartType, openAccumulated);
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
          openPartIndex = globalIndex++;
          openPartType = "text";
          openAccumulated = "";
          emitPartStart(startCbs, openPartIndex, "text");
          break;
        }

        case "text-delta": {
          const part = turnParts[chunk.data.index] as ContentPartText;
          part.text += chunk.data.text;
          openAccumulated = part.text;
          turnSpan?.appendLLMStream(chunk.data.text);
          emitPartUpdate(updateCbs, openPartIndex, "text", chunk.data.text, openAccumulated);
          break;
        }

        case "text-complete": {
          closePart();
          break;
        }

        case "thinking-start": {
          closePart();
          turnParts.push({ type: "thinking", text: "" });
          openPartIndex = globalIndex++;
          openPartType = "thinking";
          openAccumulated = "";
          emitPartStart(startCbs, openPartIndex, "thinking");
          break;
        }

        case "thinking-delta": {
          const part = turnParts[chunk.data.index] as ContentPartThinking;
          part.text += chunk.data.text;
          openAccumulated = part.text;
          emitPartUpdate(updateCbs, openPartIndex, "thinking", chunk.data.text, openAccumulated);
          break;
        }

        case "thinking-summary-delta": {
          const part = turnParts[chunk.data.index] as ContentPartThinking;
          part.text += chunk.data.text;
          openAccumulated = part.text;
          emitPartUpdate(updateCbs, openPartIndex, "thinking", chunk.data.text, openAccumulated);
          break;
        }

        case "thinking-complete": {
          closePart();
          break;
        }

        case "tool-call-start": {
          closePart();
          turnParts.push({
            type: "tool-call",
            id: chunk.data.id,
            name: chunk.data.name,
            parameters: {},
          });
          globalIndex++;
          break;
        }

        case "tool-call-complete": {
          const part = turnParts[chunk.data.index] as ContentPartToolCall;
          if (chunk.data.id) part.id = chunk.data.id;
          if (chunk.data.name) part.name = chunk.data.name;
          part.parameters = chunk.data.arguments;
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
          for (const cb of internalToolCbs)
            cb({ type: "start", index: idx, id: chunk.data.id, name: chunk.data.name });
          break;
        }

        case "internal-tool-complete": {
          const part = turnParts[chunk.data.index] as ContentPartInternalTool;
          if (chunk.data.output != null) part.output = chunk.data.output;
          for (const cb of internalToolCbs)
            cb({
              type: "complete",
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

    // Execute tool calls
    const wrappedToolCall = onToolCall
      ? async (name: string, parameters: Record<string, unknown>) => {
          return onToolCall(name, parameters);
        }
      : async () => null as ToolCallResult | null;

    const { results, missingTool } = await executeToolCalls(toolCalls, wrappedToolCall, tracer);

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
