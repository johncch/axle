import { AxleAbortError } from "../errors/AxleAbortError.js";
import { AxleError } from "../errors/AxleError.js";
import { AxleToolFatalError } from "../errors/AxleToolFatalError.js";
import type {
  AxleAssistantMessage,
  AxleMessage,
  AxleToolCallResult,
  Citation,
  CitationSource,
  ContentPart,
  ContentPartToolCall,
  ToolResultPart,
} from "../messages/message.js";
import { getCitations, getTextContent, getThinkingContent } from "../messages/utils.js";
import { logContent } from "../observability/log.js";
import type { Span } from "../observability/types.js";
import type {
  ExecutableTool,
  ProviderTool,
  ToolContext,
  ToolProgressChunk,
} from "../tools/types.js";
import type { Stats } from "../types.js";
import { addStats, createStats, mergeStats } from "../utils/stats.js";
import type { AIProvider } from "./types.js";

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

export interface ToolExecutionObserver {
  onStart?(call: ContentPartToolCall): void;
  onDelta?(call: ContentPartToolCall, chunk: ToolProgressChunk): void;
  onComplete?(call: ContentPartToolCall, outcome: ToolExecutionOutcome): void;
  onError?(call: ContentPartToolCall, error: AxleAbortError | AxleToolFatalError): void;
}

export interface ToolExecutionOutcome {
  result: ToolCallResult;
  usage?: Stats;
}

/**
 * Why a `generate()`, `stream()`, or `agent.send()` resolved `ok: false`.
 *
 * - `model`: the provider failed the request. `type` is `"authentication"`
 *   when the provider rejected the credential, else the provider's own error
 *   type. `status` is the HTTP status when the failure was an HTTP response.
 * - `refusal`: the provider declined the request or blocked its output.
 * - `parse`: the response did not match the `Instruct` schema.
 */
export type AxleFailure =
  | {
      kind: "model";
      type: string;
      message: string;
      status?: number;
      usage?: Stats;
      raw?: unknown;
    }
  | { kind: "refusal"; message: string; text?: string; category?: string }
  | { kind: "parse"; message: string; cause: unknown };

/** @deprecated Use AxleFailure. */
export type GenerateError = AxleFailure;

export type StreamResult<TResponse = AxleAssistantMessage> =
  | {
      ok: true;
      response: TResponse;
      messages: AxleMessage[];
      final: AxleAssistantMessage;
      error?: undefined;
      usage?: Stats;
      /**
       * Present when a configured limit ended the tool loop at a request
       * boundary. The conversation is well-formed and continuable;
       * `final.finishReason` keeps the provider's own reason for the last
       * message (typically `FunctionCall` — the model wanted to continue).
       */
      stopped?: "max-steps" | "token-limit";
    }
  | {
      ok: false;
      response?: undefined;
      final?: AxleAssistantMessage;
      messages: AxleMessage[];
      error: AxleFailure;
      usage?: Stats;
      /**
       * Present on a `parse` error when a loop limit ended an Instruct call
       * before the model produced parseable output. The conversation is still
       * well-formed and continuable.
       */
      stopped?: "max-steps" | "token-limit";
    };

export type GenerateResult<TResponse = AxleAssistantMessage> = StreamResult<TResponse>;

/**
 * Validate tool-loop limit options at the call boundary. Non-positive limits
 * are caller bugs, not runtime conditions — they fail loudly here so the
 * loop can assume a limit trip always has at least one completed step.
 */
export function validateLoopLimits(options: {
  maxSteps?: number;
  maxContextTokens?: number;
}): void {
  if (options.maxSteps !== undefined && options.maxSteps < 1) {
    throw new AxleError(`maxSteps must be at least 1 (got ${options.maxSteps})`, {
      code: "INVALID_OPTIONS",
    });
  }
  if (options.maxContextTokens !== undefined && options.maxContextTokens < 1) {
    throw new AxleError(`maxContextTokens must be at least 1 (got ${options.maxContextTokens})`, {
      code: "INVALID_OPTIONS",
    });
  }
}

/**
 * Decide whether a configured limit ends the tool loop after a settled step.
 * Used by the shared stream() and generate() loop.
 */
export function checkLoopStop(
  steps: number,
  usage: { in: number; out: number } | undefined,
  limits: { maxSteps?: number; maxContextTokens?: number },
): "max-steps" | "token-limit" | undefined {
  if (limits.maxSteps !== undefined && steps >= limits.maxSteps) {
    return "max-steps";
  }
  const contextTokens = usage ? usage.in + usage.out : 0;
  if (limits.maxContextTokens !== undefined && contextTokens >= limits.maxContextTokens) {
    return "token-limit";
  }
  return undefined;
}

export function logStepContent(span: Span | undefined, content: ContentPart[]): void {
  if (!span) return;
  logContent(span, "text", getTextContent(content));
  const thinking = getThinkingContent(content);
  if (thinking) span.debug("thinking", { thinking });
  for (const part of content) {
    if (part.type === "provider-tool") {
      span.info(part.name, { type: "provider-tool", input: part.input, result: part.result });
    } else if (part.type === "provider-tool-result") {
      span.info(part.name, { type: "provider-tool", result: part.result });
    } else {
      continue;
    }
    if (part.continuity)
      span.trace(part.name, { type: "provider-tool", continuity: part.continuity });
  }
  logCitations(span, getCitations(content));
}

const CITATION_PREVIEW = 8;

function logCitations(span: Span, citations: Citation[]): void {
  if (citations.length === 0) return;
  const sources = uniqueSources(citations);
  span.info("citations", {
    count: citations.length,
    sources: sources.slice(0, CITATION_PREVIEW),
    ...(sources.length > CITATION_PREVIEW ? { more: sources.length - CITATION_PREVIEW } : {}),
  });
  if (sources.length > CITATION_PREVIEW) span.debug("citations", { sources });
  span.setAttribute("citationCount", citations.length);
}

function uniqueSources(
  citations: Citation[],
): Array<{ type: string; title?: string; url?: string }> {
  const seen = new Set<string>();
  const sources: Array<{ type: string; title?: string; url?: string }> = [];
  for (const { source } of citations) {
    const url = sourceUrl(source);
    const title = "title" in source ? source.title : undefined;
    const key = url ?? title ?? source.type;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({
      type: source.type,
      ...(title ? { title } : {}),
      ...(url ? { url } : {}),
    });
  }
  return sources;
}

function sourceUrl(source: CitationSource): string | undefined {
  switch (source.type) {
    case "web":
    case "search-result":
      return source.url;
    case "retrieved-context":
      return source.uri;
    case "document":
      return source.fileId;
    default:
      return undefined;
  }
}

export function serializeToolError(error: { type: string; message: string }): string {
  return JSON.stringify({ error });
}

export interface ResolvedTools {
  executable(): ExecutableTool[];
  provider(): ProviderTool[];
  get(name: string): ExecutableTool | undefined;
}

export function resolveTools(
  toolSet: { tools?: ExecutableTool[]; providerTools?: ProviderTool[] },
  provider: AIProvider,
): ResolvedTools {
  const tools = toolSet.tools ?? [];
  const providerTools = toolSet.providerTools ?? [];
  const byName = new Map<string, ExecutableTool>();
  for (const tool of tools) {
    if (byName.has(tool.name)) {
      throw new AxleError(`Tool already registered: ${tool.name}`, {
        code: "TOOL_REGISTRY_DUPLICATE",
        details: { name: tool.name },
      });
    }
    byName.set(tool.name, tool);
  }

  return {
    executable: () => tools,
    provider: () => providerTools,
    get: (name) => byName.get(name) ?? provider.tools?.find((tool) => tool.name === name),
  };
}

type ToolExecutionSource = Pick<ResolvedTools, "get">;

export async function executeToolCalls(
  toolCalls: ContentPartToolCall[],
  onToolCall: ToolCallCallback = async () => null,
  signal: AbortSignal,
  source: ToolExecutionSource,
  span?: Span,
  observer?: ToolExecutionObserver,
): Promise<{ results: AxleToolCallResult[]; usage?: Stats }> {
  const results: AxleToolCallResult[] = [];
  const usage = createStats();
  let hasUsage = false;

  for (const call of toolCalls) {
    let executed: ExecutedToolCall;
    try {
      executed = await executeOneToolCall(call, onToolCall, signal, source, span, observer);
    } catch (error) {
      // A terminal throw must still account for usage already reported by
      // completed calls earlier in this batch.
      throw hasUsage ? attachUsage(error, usage) : error;
    }
    results.push(executed.result);
    if (executed.usage) {
      addStats(usage, executed.usage);
      hasUsage = true;
    }
  }

  return { results, ...(hasUsage ? { usage } : {}) };
}

function attachUsage(error: unknown, usage: Stats): unknown {
  if (error instanceof AxleToolFatalError) {
    return new AxleToolFatalError(error.message, {
      toolName: error.toolName,
      messages: error.messages,
      partial: error.partial,
      usage: mergeStats(usage, error.usage),
      cause: error.cause,
    });
  }
  if (error instanceof AxleAbortError) {
    return new AxleAbortError(error.message, {
      reason: error.reason,
      messages: error.messages,
      partial: error.partial,
      usage: mergeStats(usage, error.usage),
    });
  }
  return error;
}

interface ExecutedToolCall {
  result: AxleToolCallResult;
  usage?: Stats;
}

async function executeOneToolCall(
  call: ContentPartToolCall,
  onToolCall: ToolCallCallback,
  signal: AbortSignal,
  source: ToolExecutionSource,
  span?: Span,
  observer?: ToolExecutionObserver,
): Promise<ExecutedToolCall> {
  if (signal.aborted) throw new AxleAbortError("Operation aborted", { reason: signal.reason });

  const tool = source.get(call.name);
  const toolSpan = span?.startSpan(call.name, { type: "tool" });
  let usage: Stats | undefined;
  const ctx: ToolContext = {
    signal,
    span: toolSpan,
    emit: (chunk) => observer?.onDelta?.(call, chunk),
    reportUsage: (reported) => {
      usage ??= createStats();
      addStats(usage, reported);
    },
  };
  observer?.onStart?.(call);

  let resolved: ToolCallResult | null | undefined;
  let errorType = "exception";

  try {
    resolved = await onToolCall(call.name, call.parameters, ctx);
    if (resolved == null && tool) {
      errorType = "execution";
      const content = await tool.execute(call.parameters, ctx);
      resolved = { type: "success", content };
    }

    if (signal.aborted) {
      throw new AxleAbortError("Operation aborted", { reason: signal.reason });
    }
  } catch (error) {
    const terminal = normalizeTerminalToolError(error, signal);
    if (terminal) {
      toolSpan?.setResult({
        kind: "tool",
        name: call.name,
        input: call.parameters,
        output: {
          type: terminal instanceof AxleToolFatalError ? "fatal" : "aborted",
          message: terminal.message,
        },
      });
      toolSpan?.end(terminal instanceof AxleToolFatalError ? "error" : "ok");
      const withCallUsage = usage
        ? (attachUsage(terminal, usage) as AxleAbortError | AxleToolFatalError)
        : terminal;
      observer?.onError?.(call, withCallUsage);
      throw withCallUsage;
    }
    resolved = {
      type: "error",
      error: {
        type: errorType,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  if (resolved == null) {
    const message = `Tool not found: ${call.name}`;
    resolved = { type: "error", error: { type: "not-found", message } };
  }

  const outcome: ToolExecutionOutcome = {
    result: resolved,
    ...(usage ? { usage } : {}),
  };
  observer?.onComplete?.(call, outcome);

  const output =
    resolved.type === "success" ? resolved.content : serializeToolError(resolved.error);
  toolSpan?.setResult({
    kind: "tool",
    name: call.name,
    input: call.parameters,
    output: resolved.type === "success" ? resolved.content : resolved.error,
  });
  toolSpan?.end(resolved.type === "success" ? "ok" : "error");

  return {
    result: {
      id: call.id,
      name: call.name,
      content: output,
      ...(resolved.type === "error" ? { isError: true } : {}),
    },
    ...(usage ? { usage } : {}),
  };
}

function normalizeTerminalToolError(
  error: unknown,
  signal: AbortSignal,
): AxleAbortError | AxleToolFatalError | undefined {
  if (error instanceof AxleToolFatalError) return error;
  if (error instanceof AxleAbortError) return error;
  // A bare AbortError (e.g. a tool's internal fetch timeout) is only terminal
  // when the run's own signal aborted; otherwise it is an ordinary tool error
  // the model can react to.
  if (signal.aborted) {
    return new AxleAbortError("Operation aborted", { reason: signal.reason });
  }
  return undefined;
}
