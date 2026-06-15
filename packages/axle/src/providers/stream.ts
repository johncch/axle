import { getAxleConfiguration, type AxleConfiguration } from "../config.js";
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
  Citation,
  ContentPartCitation,
  ContentPartProviderTool,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
  ThinkingContinuity,
} from "../messages/message.js";
import type { LLMResult, Span } from "../observability/types.js";
import { ToolRegistry } from "../tools/registry.js";
import type {
  ExecutableTool,
  ProviderTool,
  ToolDefinition,
  ToolProgressChunk,
} from "../tools/types.js";
import type { Stats } from "../types.js";
import type { FileResolver } from "../utils/file.js";
import { addStats, attributeStats, createStats, mergeStats, toTokenUsage } from "../utils/stats.js";
import {
  executeToolCalls,
  logTurnContent,
  resolveToolRegistry,
  resolveTools,
  serializeToolError,
  type GenerateError,
  type StreamResult,
  type ToolCallCallback,
  type ToolCallResult,
  type ToolExecutionOutcome,
} from "./helpers.js";
import type { AIProvider, AxleModelRequestOptions } from "./types.js";
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
  | { type: "text:citation"; index: number; citation: Citation; citations: Citation[] }
  | { type: "text:end"; index: number; final: string }
  // Unanchored citation/source parts
  | {
      type: "citation";
      index: number;
      citations: Citation[];
      providerMetadata?: Record<string, unknown>;
    }
  // Thinking streaming
  | {
      type: "thinking:start";
      index: number;
      redacted?: boolean;
      continuity?: ThinkingContinuity;
      providerMetadata?: Record<string, unknown>;
    }
  | { type: "thinking:delta"; index: number; delta: string; accumulated: string }
  | { type: "thinking:summary-delta"; index: number; delta: string; accumulated: string }
  | {
      type: "thinking:update";
      index: number;
      redacted?: boolean;
      continuity?: ThinkingContinuity;
      providerMetadata?: Record<string, unknown>;
    }
  | { type: "thinking:end"; index: number; final: string }
  // Tool calls
  | { type: "tool:request"; index: number; id: string; name: string; kind?: "tool" | "agent" }
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
      chunk: ToolProgressChunk;
    }
  | {
      type: "tool:exec-complete";
      index: number;
      id: string;
      name: string;
      result: ToolCallResult;
      usage?: Stats;
    }
  | {
      type: "tool:exec-error";
      index: number;
      id: string;
      name: string;
      error: { type: "fatal" | "aborted"; message: string };
      usage?: Stats;
    }
  // Provider tools (provider-managed: web search, code interpreter, etc.)
  | { type: "provider-tool:start"; index: number; id: string; name: string }
  | { type: "provider-tool:complete"; index: number; id: string; name: string; output?: unknown }
  // Error
  | { type: "error"; error: GenerateError };

export type StreamEventCallback = (event: StreamEvent) => void;

export interface StreamParams extends AxleModelRequestOptions {
  provider: AIProvider;
  model: string;
  messages: Array<AxleMessage>;
  system?: string;
  tools?: ExecutableTool[];
  providerTools?: ProviderTool[];
  registry?: ToolRegistry;
  onToolCall?: ToolCallCallback;
  maxIterations?: number;
  span?: Span;
  fileResolver?: FileResolver;
}

export interface StreamHandle {
  on(callback: StreamEventCallback): void;
  cancel(reason?: unknown): void;
  readonly final: Promise<StreamResult>;
}

export interface StreamInstructParams<TSchema extends OutputSchema | undefined> extends Omit<
  StreamParams,
  "messages"
> {
  messages?: Array<AxleMessage>;
  instruct: Instruct<TSchema>;
}

export type StreamInstructResult<TSchema extends OutputSchema | undefined> = StreamResult<
  InstructResponse<TSchema>
>;

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

type ToolCallArgumentError = {
  type: string;
  message: string;
  raw?: string;
};

function toArgumentErrorResult(error: ToolCallArgumentError): Extract<ToolCallResult, { type: "error" }> {
  const message = error.raw ? `${error.message}\nRaw buffer: ${error.raw}` : error.message;
  return {
    type: "error",
    error: {
      type: error.type,
      message,
    },
  };
}

function toToolDefinition(tool: ExecutableTool): ToolDefinition {
  return { name: tool.name, description: tool.description, schema: tool.schema };
}

export function stream<TSchema extends OutputSchema | undefined>(
  options: StreamInstructParams<TSchema>,
): StreamInstructHandle<TSchema>;
export function stream(options: StreamParams): StreamHandle;
export function stream(options: StreamParams | StreamInstructParams<any>): StreamHandle {
  const callbacks: StreamEventCallback[] = [];
  let streamOptions: StreamParams;
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
  const configuration = getAxleConfiguration();

  // Kick off processing on next microtask so callers can register callbacks first
  Promise.resolve().then(() =>
    run(streamOptions, effectiveSignal, callbacks, configuration).then((result) => {
      if (parse && result.ok) {
        try {
          resolve({ ...result, response: parse(result.final) });
        } catch (parseError) {
          resolve({
            ok: false,
            messages: result.messages,
            final: result.final,
            usage: result.usage,
            error: {
              kind: "parse",
              error: parseError,
              message: parseError instanceof Error ? parseError.message : String(parseError),
            },
          });
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
  options: StreamParams,
  signal: AbortSignal,
  cbs: StreamEventCallback[],
  configuration: AxleConfiguration,
): Promise<StreamResult> {
  const {
    provider,
    model,
    messages,
    system,
    onToolCall,
    maxIterations,
    span,
    fileResolver,
    reasoning,
    maxOutputTokens,
    temperature,
    topP,
    stop,
    toolChoice,
    parallelToolCalls,
    providerOptions,
  } = options;
  const registry = resolveToolRegistry(options);
  const resolvedTools = resolveTools(registry, {
    provider,
    model,
    span,
    configuration,
  });
  const workingMessages = [...messages];
  const newMessages: AxleMessage[] = [];
  const usage: Stats = createStats();
  let globalIndex = 0;
  let iterations = 0;

  const addMessage = (message: AxleMessage) => {
    workingMessages.push(message);
    newMessages.push(message);
  };

  const endWithResult = (result: StreamResult): StreamResult => {
    if (!result.ok) {
      emit(cbs, { type: "error", error: result.error });
    }
    const finalContent = result.ok ? result.final.content : null;
    const finishReason = result.ok ? result.final.finishReason : undefined;
    span?.setResult({
      kind: "llm",
      model,
      request: { messages },
      response: { content: finalContent ?? null },
      usage: toTokenUsage(result.usage),
      finishReason,
    });
    span?.end(result.ok ? "ok" : "error");
    return result;
  };

  const throwAbortError = (
    turnParts: Array<
      | ContentPartText
      | ContentPartThinking
      | ContentPartToolCall
      | ContentPartProviderTool
      | ContentPartCitation
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
    span?.end("ok");
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
        ok: false,
        messages: newMessages,
        error: {
          kind: "model",
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
    const turnSpan = span?.startSpan(`turn-${iterations}`, { type: "llm" });

    const executable = resolvedTools.executable();
    const tools = executable.length > 0 ? executable.map(toToolDefinition) : undefined;
    const providerTools = resolvedTools.provider();

    const streamSource = provider.createStreamingRequest(model, {
      messages: workingMessages,
      system,
      tools,
      providerTools: providerTools.length > 0 ? providerTools : undefined,
      runtime: { span: turnSpan, fileResolver },
      signal,
      reasoning,
      maxOutputTokens,
      temperature,
      topP,
      stop,
      toolChoice,
      parallelToolCalls,
      providerOptions,
    });

    const turnParts: Array<
      | ContentPartText
      | ContentPartThinking
      | ContentPartToolCall
      | ContentPartProviderTool
      | ContentPartCitation
    > = [];
    let turnId = "";
    let turnModel = "";
    let turnFinishReason: AxleStopReason | null = null;
    let turnUsage: Stats = createStats();

    // Track the current "open" part for accumulation
    let openPartIndex = -1;
    let openPartType: "text" | "thinking" | null = null;
    let openAccumulated: string = "";

    // Track tool call id → globalIndex for tool execution events
    const toolCallIndexMap = new Map<string, number>();
    const toolCallArgumentErrors = new Map<string, ToolCallArgumentError>();
    const chunkIndexToPartIndex = new Map<number, number>();
    const chunkIndexToGlobalIndex = new Map<number, number>();

    // Some chat-completions vendors stream the first tool_call delta before
    // the function name is known. tool:request carries the name and the
    // registry-resolved kind, so its emission is deferred until then.
    const pendingToolRequests = new Set<string>();
    const emitToolRequest = (id: string, name: string) => {
      emit(cbs, {
        type: "tool:request",
        index: toolCallIndexMap.get(id) ?? -1,
        id,
        name,
        kind: resolvedTools.get(name)?.kind ?? "tool",
      });
    };

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
          chunkIndexToPartIndex.set(chunk.data.index, currentPartIndex);
          chunkIndexToGlobalIndex.set(chunk.data.index, openPartIndex);
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

        case "text-citation": {
          const partIndex = chunkIndexToPartIndex.get(chunk.data.index) ?? currentPartIndex;
          const eventIndex = chunkIndexToGlobalIndex.get(chunk.data.index) ?? openPartIndex;
          const part = turnParts[partIndex] as ContentPartText;
          if (!part || part.type !== "text") break;
          part.citations = [...(part.citations ?? []), chunk.data.citation];
          emit(cbs, {
            type: "text:citation",
            index: eventIndex,
            citation: chunk.data.citation,
            citations: part.citations,
          });
          break;
        }

        case "citation": {
          closePart();
          const idx = globalIndex++;
          turnParts.push({
            type: "citation",
            citations: chunk.data.citations,
            ...(chunk.data.providerMetadata
              ? { providerMetadata: chunk.data.providerMetadata }
              : {}),
          });
          currentPartIndex = turnParts.length - 1;
          chunkIndexToPartIndex.set(chunk.data.index, currentPartIndex);
          chunkIndexToGlobalIndex.set(chunk.data.index, idx);
          emit(cbs, {
            type: "citation",
            index: idx,
            citations: chunk.data.citations,
            providerMetadata: chunk.data.providerMetadata,
          });
          break;
        }

        case "text-complete": {
          closePart();
          break;
        }

        case "thinking-start": {
          closePart();
          turnParts.push({
            type: "thinking",
            text: "",
            ...(chunk.data.id ? { id: chunk.data.id } : {}),
            ...(chunk.data.redacted !== undefined ? { redacted: chunk.data.redacted } : {}),
            ...(chunk.data.continuity ? { continuity: chunk.data.continuity } : {}),
            ...(chunk.data.providerMetadata
              ? { providerMetadata: chunk.data.providerMetadata }
              : {}),
          });
          currentPartIndex = turnParts.length - 1;
          openPartIndex = globalIndex++;
          chunkIndexToPartIndex.set(chunk.data.index, currentPartIndex);
          chunkIndexToGlobalIndex.set(chunk.data.index, openPartIndex);
          openPartType = "thinking";
          openAccumulated = "";
          emit(cbs, {
            type: "thinking:start",
            index: openPartIndex,
            redacted: chunk.data.redacted,
            continuity: chunk.data.continuity,
            providerMetadata: chunk.data.providerMetadata,
          });
          break;
        }

        case "thinking-delta": {
          const part = turnParts[currentPartIndex] as ContentPartThinking;
          part.text = (part.text ?? "") + chunk.data.text;
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
          part.summary = (part.summary ?? "") + chunk.data.text;
          openAccumulated = part.summary;
          emit(cbs, {
            type: "thinking:summary-delta",
            index: openPartIndex,
            delta: chunk.data.text,
            accumulated: openAccumulated,
          });
          break;
        }

        case "thinking-metadata": {
          const partIndex = chunkIndexToPartIndex.get(chunk.data.index) ?? currentPartIndex;
          const eventIndex = chunkIndexToGlobalIndex.get(chunk.data.index) ?? openPartIndex;
          const part = turnParts[partIndex] as ContentPartThinking;
          if (!part || part.type !== "thinking") break;
          if (chunk.data.redacted !== undefined) part.redacted = chunk.data.redacted;
          if (chunk.data.continuity) part.continuity = chunk.data.continuity;
          if (chunk.data.providerMetadata) part.providerMetadata = chunk.data.providerMetadata;
          emit(cbs, {
            type: "thinking:update",
            index: eventIndex,
            redacted: chunk.data.redacted,
            continuity: chunk.data.continuity,
            providerMetadata: chunk.data.providerMetadata,
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
          chunkIndexToPartIndex.set(chunk.data.index, currentPartIndex);
          chunkIndexToGlobalIndex.set(chunk.data.index, idx);
          toolCallIndexMap.set(chunk.data.id, idx);
          if (chunk.data.name) {
            emitToolRequest(chunk.data.id, chunk.data.name);
          } else {
            pendingToolRequests.add(chunk.data.id);
          }
          break;
        }

        case "tool-call-args-delta": {
          if (pendingToolRequests.has(chunk.data.id) && chunk.data.name) {
            pendingToolRequests.delete(chunk.data.id);
            emitToolRequest(chunk.data.id, chunk.data.name);
          }
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
          const targetIndex = chunkIndexToPartIndex.get(chunk.data.index) ?? currentPartIndex;
          const part = turnParts[targetIndex] as ContentPartToolCall;
          if (!part || part.type !== "tool-call") break;
          if (chunk.data.id) part.id = chunk.data.id;
          if (chunk.data.name) part.name = chunk.data.name;
          part.parameters = chunk.data.arguments;
          if (chunk.data.providerMetadata) part.providerMetadata = chunk.data.providerMetadata;
          if (chunk.data.error) toolCallArgumentErrors.set(part.id, chunk.data.error);
          if (pendingToolRequests.has(part.id) && part.name) {
            pendingToolRequests.delete(part.id);
            emitToolRequest(part.id, part.name);
          }
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
          chunkIndexToPartIndex.set(chunk.data.index, currentPartIndex);
          chunkIndexToGlobalIndex.set(chunk.data.index, idx);
          emit(cbs, {
            type: "provider-tool:start",
            index: idx,
            id: chunk.data.id,
            name: chunk.data.name,
          });
          break;
        }

        case "provider-tool-complete": {
          const partIndex = chunkIndexToPartIndex.get(chunk.data.index) ?? currentPartIndex;
          const eventIndex = chunkIndexToGlobalIndex.get(chunk.data.index) ?? chunk.data.index;
          const part = turnParts[partIndex] as ContentPartProviderTool;
          if (part && part.type === "provider-tool" && chunk.data.output != null) {
            part.output = chunk.data.output;
          }
          emit(cbs, {
            type: "provider-tool:complete",
            index: eventIndex,
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
          if (chunk.data.usage) {
            addStats(
              usage,
              attributeStats(chunk.data.usage, {
                provider: provider.name,
                model: turnModel || model,
              }),
            );
          }
          turnSpan?.end("error");
          return endWithResult({
            ok: false,
            messages: newMessages,
            error: {
              kind: "model",
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
        ok: false,
        messages: newMessages,
        error: {
          kind: "model",
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

    const attributedTurnUsage = attributeStats(turnUsage, {
      provider: provider.name,
      model: turnModel || model,
    });
    addStats(usage, attributedTurnUsage);

    const turnLLMResult: LLMResult = {
      kind: "llm",
      model: turnModel,
      request: { messages: workingMessages },
      response: { content: turnParts },
      usage: toTokenUsage(turnUsage),
      finishReason: turnFinishReason,
    };
    logTurnContent(turnSpan, turnParts);

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
    emit(cbs, {
      type: "turn:complete",
      message: assistantMessage,
      usage: attributedTurnUsage,
    });

    // If not a function call, we're done
    if (turnFinishReason !== AxleStopReason.FunctionCall) {
      return endWithResult({
        ok: true,
        response: assistantMessage,
        messages: newMessages,
        final: assistantMessage,
        usage,
      });
    }

    // Extract tool calls from the turn's parts
    const toolCalls = turnParts.filter((p): p is ContentPartToolCall => p.type === "tool-call");
    if (toolCalls.length === 0) {
      return endWithResult({
        ok: true,
        response: assistantMessage,
        messages: newMessages,
        final: assistantMessage,
        usage,
      });
    }

    // Check 3: before tool execution
    if (signal.aborted) {
      span?.end("ok");
      throw new AxleAbortError("Stream aborted", {
        reason: signal.reason,
        messages: newMessages,
        usage,
      });
    }

    const toolResultsId = crypto.randomUUID();
    emit(cbs, { type: "tool-results:start", id: toolResultsId });

    const executableToolCalls: ContentPartToolCall[] = [];
    const syntheticResults = new Map<string, AxleToolCallMessage["content"][number]>();
    for (const call of toolCalls) {
      const argumentError = toolCallArgumentErrors.get(call.id);
      if (!argumentError) {
        executableToolCalls.push(call);
        continue;
      }
      const result = toArgumentErrorResult(argumentError);
      syntheticResults.set(call.id, {
        id: call.id,
        name: call.name,
        content: serializeToolError(result.error),
        isError: true,
      });
      emit(cbs, {
        type: "tool:exec-complete",
        index: toolCallIndexMap.get(call.id) ?? -1,
        id: call.id,
        name: call.name,
        result,
      });
    }

    const executionObserver = {
      onStart(call: ContentPartToolCall) {
        const idx = toolCallIndexMap.get(call.id) ?? -1;
        emit(cbs, {
          type: "tool:exec-start",
          index: idx,
          id: call.id,
          name: call.name,
          parameters: call.parameters,
        });
      },
      onDelta(call: ContentPartToolCall, chunk: ToolProgressChunk) {
        const idx = toolCallIndexMap.get(call.id) ?? -1;
        emit(cbs, {
          type: "tool:exec-delta",
          index: idx,
          id: call.id,
          name: call.name,
          chunk,
        });
      },
      onComplete(call: ContentPartToolCall, outcome: ToolExecutionOutcome) {
        const idx = toolCallIndexMap.get(call.id) ?? -1;
        emit(cbs, {
          type: "tool:exec-complete",
          index: idx,
          id: call.id,
          name: call.name,
          result: outcome.result,
          usage: outcome.usage,
        });
      },
      onError(call: ContentPartToolCall, error: AxleAbortError | AxleToolFatalError) {
        const idx = toolCallIndexMap.get(call.id) ?? -1;
        emit(cbs, {
          type: "tool:exec-error",
          index: idx,
          id: call.id,
          name: call.name,
          error: {
            type: error instanceof AxleToolFatalError ? "fatal" : "aborted",
            message: error.message,
          },
          usage: error.usage,
        });
      },
    };

    let executedResults: AxleToolCallMessage["content"] = [];
    let toolUsage: Stats | undefined;
    try {
      if (executableToolCalls.length > 0) {
        ({ results: executedResults, usage: toolUsage } = await executeToolCalls(
          executableToolCalls,
          onToolCall,
          signal,
          resolvedTools,
          span,
          executionObserver,
        ));
      }
    } catch (error) {
      if (error instanceof AxleToolFatalError) {
        span?.end("error");
        throw new AxleToolFatalError(error.message, {
          toolName: error.toolName,
          messages: error.messages ?? newMessages,
          partial: error.partial ?? assistantMessage,
          usage: mergeStats(usage, error.usage),
          cause: error.cause,
        });
      }
      if (error instanceof AxleAbortError) {
        span?.end("ok");
        throw new AxleAbortError("Stream aborted", {
          reason: error.reason,
          messages: error.messages ?? newMessages,
          partial: error.partial,
          usage: mergeStats(usage, error.usage),
        });
      }
      throw error;
    }

    addStats(usage, toolUsage);

    const executedResultsById = new Map(executedResults.map((result) => [result.id, result]));
    const results = toolCalls.flatMap((call) => {
      const synthetic = syntheticResults.get(call.id);
      if (synthetic) return [synthetic];
      const executed = executedResultsById.get(call.id);
      return executed ? [executed] : [];
    });

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
