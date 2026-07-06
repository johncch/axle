import { AxleAbortError } from "../../errors/AxleAbortError.js";
import { AxleToolFatalError } from "../../errors/AxleToolFatalError.js";
import type {
  AxleAssistantMessage,
  AxleMessage,
  AxleToolCallMessage,
  ContentPartToolCall,
} from "../../messages/message.js";
import type { Span } from "../../observability/types.js";
import type { ToolProgressChunk } from "../../tools/types.js";
import type { Stats } from "../../types.js";
import { addStats, mergeStats } from "../../utils/stats.js";
import type {
  ResolvedTools,
  ToolCallCallback,
  ToolCallResult,
  ToolExecutionOutcome,
} from "../helpers.js";
import { executeToolCalls, serializeToolError } from "../helpers.js";
import type { StreamEvent } from "../stream.js";
import type { CompletedTurn, ToolCallArgumentError } from "./turnReader.js";

/**
 * Per-run state the tool loop shares with its helpers: event delivery,
 * cancellation, tools, tracing, and the accumulating conversation/usage.
 */
export interface LoopContext {
  emit: (event: StreamEvent) => void;
  signal: AbortSignal;
  resolvedTools: ResolvedTools;
  span?: Span;
  onToolCall?: ToolCallCallback;
  newMessages: AxleMessage[];
  usage: Stats;
  addMessage: (message: AxleMessage) => void;
}

function toArgumentErrorResult(
  error: ToolCallArgumentError,
): Extract<ToolCallResult, { type: "error" }> {
  const message = error.raw ? `${error.message}\nRaw buffer: ${error.raw}` : error.message;
  return {
    type: "error",
    error: {
      type: error.type,
      message,
    },
  };
}

/**
 * Answer a completed turn's tool calls: synthesize results for calls whose
 * arguments failed to parse, execute the rest, and append the tool results
 * message. Mutates the loop's shared `usage` and, via `addMessage`, its
 * working conversation. Abort and fatal errors are rethrown enriched with
 * the loop's accumulated messages and usage so callers can preserve state.
 */
export async function executeTurnTools(
  toolCalls: ContentPartToolCall[],
  turn: CompletedTurn,
  assistantMessage: AxleAssistantMessage,
  loop: LoopContext,
): Promise<void> {
  const { toolCallArgumentErrors } = turn;
  const { emit, signal, resolvedTools, span, onToolCall, newMessages, usage, addMessage } = loop;

  const toolResultsId = crypto.randomUUID();
  emit({ type: "tool-results:start", id: toolResultsId });

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
    emit({
      type: "tool:exec-complete",
      id: call.id,
      name: call.name,
      result,
    });
  }

  const executionObserver = {
    onStart(call: ContentPartToolCall) {
      emit({
        type: "tool:exec-start",
        id: call.id,
        name: call.name,
        parameters: call.parameters,
      });
    },
    onDelta(call: ContentPartToolCall, chunk: ToolProgressChunk) {
      emit({
        type: "tool:exec-delta",
        id: call.id,
        name: call.name,
        chunk,
      });
    },
    onComplete(call: ContentPartToolCall, outcome: ToolExecutionOutcome) {
      emit({
        type: "tool:exec-complete",
        id: call.id,
        name: call.name,
        result: outcome.result,
        usage: outcome.usage,
      });
    },
    onError(call: ContentPartToolCall, error: AxleAbortError | AxleToolFatalError) {
      emit({
        type: "tool:exec-error",
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
    emit({ type: "tool-results:complete", message: toolResultsMessage });
  }
}
