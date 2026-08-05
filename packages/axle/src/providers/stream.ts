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
  logStepContent,
  resolveToolRegistry,
  resolveTools,
  validateLoopLimits,
  type AxleFailure,
  type StreamResult,
  type ToolCallCallback,
  type ToolCallResult,
} from "./helpers.js";
import { readStep } from "./lib/stepReader.js";
import { executeStepTools, type LoopContext } from "./lib/stepTools.js";
import type { AIProvider, AxleModelRequestOptions } from "./types.js";
import { AxleStopReason } from "./types.js";

// --- Public types ---

export type StreamEvent =
  // Message boundaries
  | { type: "step:start"; id: string; model: string }
  | { type: "step:complete"; message: AxleAssistantMessage; usage?: Stats }
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

export type ToolBatchCompleteCallback = (
  message: AxleToolCallMessage,
) => "continue" | "finish" | Promise<"continue" | "finish">;

export interface StreamParams extends AxleModelRequestOptions {
  provider: AIProvider;
  model: string;
  messages: Array<AxleMessage>;
  system?: string;
  tools?: ExecutableTool[];
  providerTools?: ProviderTool[];
  registry?: ToolRegistry;
  onToolCall?: ToolCallCallback;
  maxSteps?: number;
  /**
   * Context budget for the tool loop, in tokens. Checked after each step's
   * tools are answered, against that step's reported usage (effective input
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
  onToolBatchComplete(callback: ToolBatchCompleteCallback): void;
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
  const control: { onToolBatchComplete?: ToolBatchCompleteCallback } = {};

  // Kick off processing on next microtask so callers can register callbacks first
  Promise.resolve().then(() =>
    run(streamOptions, effectiveSignal, callbacks, configuration, control).then((result) => {
      if (parse && result.ok) {
        try {
          resolve({ ...result, response: parse(result.final) });
        } catch (parseError) {
          resolve({
            ok: false,
            messages: result.messages,
            final: result.final,
            usage: result.usage,
            // A limit stop usually ends on a tool-call step with no parseable
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
    onToolBatchComplete(callback) {
      control.onToolBatchComplete = callback;
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
  control: { onToolBatchComplete?: ToolBatchCompleteCallback },
): Promise<StreamResult> {
  const {
    provider,
    model,
    messages,
    system,
    onToolCall,
    maxSteps,
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
  let steps = 0;

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

    steps += 1;
    const stepSpan = span?.startSpan(`step-${steps}`, { type: "llm" });

    const executable = resolvedTools.executable();
    const tools = executable.length > 0 ? executable.map(toToolDefinition) : undefined;
    const providerTools = resolvedTools.provider();

    const streamSource = provider.createStreamingRequest(model, {
      messages: workingMessages,
      system,
      tools,
      providerTools: providerTools.length > 0 ? providerTools : undefined,
      runtime: { span: stepSpan, fileResolver },
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

    const outcome = await readStep(streamSource, {
      emit: (event) => emit(cbs, event),
      tools: resolvedTools,
      signal,
    });

    if (outcome.kind === "aborted") {
      stepSpan?.end("ok");
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
      stepSpan?.end("error");
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
      stepSpan?.end("error");
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
      id: stepId,
      model: stepModel,
      parts: stepParts,
      finishReason: stepFinishReason,
      usage: stepUsage,
    } = outcome;

    const attributedStepUsage = attributeStats(stepUsage, {
      provider: provider.name,
      model: stepModel || model,
    });
    addStats(usage, attributedStepUsage);

    const stepLLMResult: LLMResult = {
      kind: "llm",
      model: stepModel,
      request: { messages: workingMessages },
      response: { content: stepParts },
      usage: toTokenUsage(stepUsage),
      finishReason: stepFinishReason,
    };
    logStepContent(stepSpan, stepParts);

    stepSpan?.setResult(stepLLMResult);
    stepSpan?.end();

    const assistantMessage: AxleAssistantMessage = {
      role: "assistant",
      id: stepId,
      model: stepModel,
      content: stepParts,
      finishReason: stepFinishReason,
    };
    addMessage(assistantMessage);
    emit(cbs, {
      type: "step:complete",
      message: assistantMessage,
      usage: attributedStepUsage,
    });

    if (stepFinishReason !== AxleStopReason.FunctionCall) {
      return endWithResult({
        ok: true,
        response: assistantMessage,
        messages: newMessages,
        final: assistantMessage,
        usage,
      });
    }

    const toolCalls = stepParts.filter((p): p is ContentPartToolCall => p.type === "tool-call");
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

    const toolResultsMessage = await executeStepTools(
      toolCalls,
      outcome,
      assistantMessage,
      loop,
    );

    if (signal.aborted) {
      span?.end("ok");
      throw new AxleAbortError("Stream aborted", {
        reason: signal.reason,
        messages: newMessages,
        usage,
      });
    }

    const boundaryDecision = toolResultsMessage
      ? await control.onToolBatchComplete?.(toolResultsMessage)
      : undefined;

    if (signal.aborted) {
      span?.end("ok");
      throw new AxleAbortError("Stream aborted", {
        reason: signal.reason,
        messages: newMessages,
        usage,
      });
    }

    if (boundaryDecision === "finish") {
      return endWithResult({
        ok: true,
        response: assistantMessage,
        messages: newMessages,
        final: assistantMessage,
        usage,
      });
    }

    // Budget checks run after the step settles so a limit stop always follows a completed step.
    const stopped = checkLoopStop(steps, stepUsage, { maxSteps, maxContextTokens });
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
