import { getAxleConfiguration, type AxleConfiguration } from "../config.js";
import { Instruct } from "../core/Instruct.js";
import type { OutputSchema } from "../core/parse.js";
import type { InstructResponse } from "../core/userTurn.js";
import { compileUserTurn } from "../core/userTurn.js";
import { AxleAbortError } from "../errors/AxleAbortError.js";
import type {
  AxleAssistantMessage,
  AxleMessage,
  AxleToolCallMessage,
  Citation,
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
import { addStats, attributeStats, createStats, toTokenUsage } from "../utils/stats.js";
import {
  checkLoopStop,
  logTurnContent,
  resolveToolRegistry,
  resolveTools,
  validateLoopLimits,
  type AxleFailure,
  type StreamResult,
  type ToolCallCallback,
  type ToolCallResult,
} from "./helpers.js";
import { readTurn } from "./lib/turnReader.js";
import { executeTurnTools, type LoopContext } from "./lib/turnTools.js";
import type { AIProvider, AxleModelRequestOptions } from "./types.js";
import { AxleStopReason } from "./types.js";

// --- Public types ---

export type StreamEvent =
  // Message boundaries
  | { type: "turn:start"; id: string; model: string }
  | { type: "turn:complete"; message: AxleAssistantMessage; usage?: Stats }
  | { type: "tool-results:start"; id: string }
  | { type: "tool-results:complete"; message: AxleToolCallMessage }
  // Text streaming (parts stream sequentially; deltas belong to the last opened part)
  | { type: "text:start" }
  | { type: "text:delta"; delta: string; accumulated: string }
  | { type: "text:citation"; citation: Citation; citations: Citation[] }
  | { type: "text:end"; final: string }
  // Unanchored citation/source parts
  | {
      type: "citation";
      citations: Citation[];
      providerMetadata?: Record<string, unknown>;
    }
  // Thinking streaming
  | {
      type: "thinking:start";
      redacted?: boolean;
      continuity?: ThinkingContinuity;
      providerMetadata?: Record<string, unknown>;
    }
  | { type: "thinking:delta"; delta: string; accumulated: string }
  | { type: "thinking:summary-delta"; delta: string; accumulated: string }
  | {
      type: "thinking:update";
      redacted?: boolean;
      continuity?: ThinkingContinuity;
      providerMetadata?: Record<string, unknown>;
    }
  | { type: "thinking:end"; final: string }
  // Tool calls (correlated by `id`)
  | { type: "tool:request"; id: string; name: string; kind?: "tool" | "agent" }
  | {
      type: "tool:args-delta";
      id: string;
      name: string;
      delta: string;
      accumulated: string;
    }
  | {
      type: "tool:exec-start";
      id: string;
      name: string;
      parameters: Record<string, unknown>;
    }
  | {
      type: "tool:exec-delta";
      id: string;
      name: string;
      chunk: ToolProgressChunk;
    }
  | {
      type: "tool:exec-complete";
      id: string;
      name: string;
      result: ToolCallResult;
      usage?: Stats;
    }
  | {
      type: "tool:exec-error";
      id: string;
      name: string;
      error: { type: "fatal" | "aborted"; message: string };
      usage?: Stats;
    }
  // Provider tools (provider-managed: web search, code interpreter, etc.)
  | { type: "provider-tool:start"; id: string; name: string }
  | { type: "provider-tool:complete"; id: string; name: string; output?: unknown }
  // Error
  | { type: "error"; error: AxleFailure };

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
  /**
   * Context budget for the tool loop, in tokens. Checked after each turn's
   * tools are answered, against that turn's reported usage (effective input
   * + output); when crossed, the loop returns `stopped: "token-limit"` with
   * everything accumulated so far. The caller decides what to do — e.g.
   * compact the conversation and start a new stream.
   */
  maxContextTokens?: number;
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

  validateLoopLimits(streamOptions);

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
            // A limit stop usually ends on a tool-call turn with no parseable
            // text; keep the stop marker so callers can distinguish
            // "continuable, limit tripped" from genuinely malformed output.
            ...(result.stopped ? { stopped: result.stopped } : {}),
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
    maxContextTokens,
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
  let iterations = 0;

  const addMessage = (message: AxleMessage) => {
    workingMessages.push(message);
    newMessages.push(message);
  };

  const loop: LoopContext = {
    emit: (event) => emit(cbs, event),
    signal,
    resolvedTools,
    span,
    onToolCall,
    newMessages,
    usage,
    addMessage,
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

  while (true) {
    if (signal.aborted) {
      span?.end("ok");
      throw new AxleAbortError("Stream aborted", {
        reason: signal.reason,
        messages: newMessages,
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

    const outcome = await readTurn(streamSource, {
      emit: (event) => emit(cbs, event),
      tools: resolvedTools,
      signal,
    });

    if (outcome.kind === "aborted") {
      turnSpan?.end("ok");
      if (outcome.partial) addMessage(outcome.partial);
      span?.end("ok");
      throw new AxleAbortError("Stream aborted", {
        reason: signal.reason,
        messages: newMessages,
        partial: outcome.partial,
        usage,
      });
    }

    if (outcome.kind === "provider-error") {
      if (outcome.usage) {
        addStats(
          usage,
          attributeStats(outcome.usage, {
            provider: provider.name,
            model: outcome.model || model,
          }),
        );
      }
      turnSpan?.end("error");
      return endWithResult({
        ok: false,
        messages: newMessages,
        error: {
          kind: "model",
          message: outcome.message,
          error: {
            type: "error",
            error: { type: outcome.errorType, message: outcome.message },
          },
        },
        usage,
      });
    }

    if (outcome.kind === "incomplete") {
      turnSpan?.end("error");
      return endWithResult({
        ok: false,
        messages: newMessages,
        error: {
          kind: "model",
          message: "Stream ended without a completion signal",
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

    const {
      id: turnId,
      model: turnModel,
      parts: turnParts,
      finishReason: turnFinishReason,
      usage: turnUsage,
    } = outcome;

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

    if (turnFinishReason !== AxleStopReason.FunctionCall) {
      return endWithResult({
        ok: true,
        response: assistantMessage,
        messages: newMessages,
        final: assistantMessage,
        usage,
      });
    }

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

    if (signal.aborted) {
      span?.end("ok");
      throw new AxleAbortError("Stream aborted", {
        reason: signal.reason,
        messages: newMessages,
        usage,
      });
    }

    await executeTurnTools(toolCalls, outcome, assistantMessage, loop);

    // Budget checks run after the turn settles so a limit stop always returns a complete exchange.
    const stopped = checkLoopStop(iterations, turnUsage, { maxIterations, maxContextTokens });
    if (stopped) {
      return endWithResult({
        ok: true,
        response: assistantMessage,
        messages: newMessages,
        final: assistantMessage,
        usage,
        stopped,
      });
    }
  }
}
