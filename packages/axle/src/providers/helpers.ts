import type { AxleConfiguration } from "../config.js";
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
import {
  getCitations,
  getProviderTools,
  getTextContent,
  getThinkingContent,
} from "../messages/utils.js";
import { logContent } from "../observability/log.js";
import type { Span } from "../observability/types.js";
import { ToolRegistry } from "../tools/registry.js";
import type {
  ExecutableTool,
  ProviderTool,
  ToolContext,
  ToolProgressChunk,
} from "../tools/types.js";
import { createWebSearchFallbackTool } from "../tools/webSearch.js";
import type { Stats } from "../types.js";
import { addStats, attributeStats, createStats, mergeStats } from "../utils/stats.js";
import type { AIProvider, ModelError, ModelResult, ResolvedProviderTool } from "./types.js";

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

export type AxleFailure =
  | { kind: "model"; error: ModelError; message: string }
  | { kind: "tool"; error: { name: string; message: string }; message: string }
  | { kind: "parse"; error: unknown; message: string };

/** @deprecated Use AxleFailure. */
export type GenerateError = AxleFailure;

export type GenerateResult<TResponse = AxleAssistantMessage> =
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
      stopped?: "max-iterations" | "token-limit";
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
      stopped?: "max-iterations" | "token-limit";
    };

export type StreamResult<TResponse = AxleAssistantMessage> = GenerateResult<TResponse>;

/**
 * Validate tool-loop limit options at the call boundary. Non-positive limits
 * are caller bugs, not runtime conditions — they fail loudly here so the
 * loop can assume a limit trip always has at least one completed turn.
 */
export function validateLoopLimits(options: {
  maxIterations?: number;
  maxContextTokens?: number;
}): void {
  if (options.maxIterations !== undefined && options.maxIterations < 1) {
    throw new AxleError(`maxIterations must be at least 1 (got ${options.maxIterations})`, {
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
 * Decide whether a configured limit ends the tool loop after a settled turn.
 * Shared by stream() and generate() so the two loops cannot drift.
 */
export function checkLoopStop(
  iterations: number,
  usage: { in: number; out: number } | undefined,
  limits: { maxIterations?: number; maxContextTokens?: number },
): "max-iterations" | "token-limit" | undefined {
  if (limits.maxIterations !== undefined && iterations >= limits.maxIterations) {
    return "max-iterations";
  }
  const contextTokens = usage ? usage.in + usage.out : 0;
  if (limits.maxContextTokens !== undefined && contextTokens >= limits.maxContextTokens) {
    return "token-limit";
  }
  return undefined;
}

export function appendUsage(
  total: Stats,
  result: ModelResult,
  source?: { provider: string; model: string },
): void {
  if (!result.usage) return;
  addStats(total, source ? attributeStats(result.usage, source) : result.usage);
}

// Logs a turn's content (text/thinking/provider-tools/citations) onto its span,
// so the streaming and non-streaming paths surface identical detail.
export function logTurnContent(span: Span | undefined, content: ContentPart[]): void {
  if (!span) return;
  logContent(span, "text", getTextContent(content));
  const thinking = getThinkingContent(content);
  if (thinking) span.debug("thinking", { thinking });
  for (const tool of getProviderTools(content)) {
    span.info(tool.name, { type: "provider-tool", input: tool.input });
    if (tool.output !== undefined) {
      span.trace(tool.name, { type: "provider-tool", output: tool.output });
    }
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
  return (
    options.registry ??
    new ToolRegistry({ tools: options.tools, providerTools: options.providerTools })
  );
}

export interface ResolvedTools {
  registry: ToolRegistry;
  executable(): ExecutableTool[];
  provider(): ResolvedProviderTool[];
  get(name: string): ExecutableTool | undefined;
}

export function resolveTools(
  registry: ToolRegistry,
  options: {
    provider: AIProvider;
    model: string;
    span?: Span;
    configuration: AxleConfiguration;
  },
): ResolvedTools {
  const requestedWebSearch = registry.getProvider("web_search");
  const resolveProviderToolName = options.provider.resolveProviderToolName?.bind(options.provider);
  if (!resolveProviderToolName) {
    return {
      registry,
      executable: () => registry.executable(),
      provider: () => registry.provider(),
      get: (name) => registry.get(name),
    };
  }

  const resolveProviderTools = (): ResolvedProviderTool[] =>
    registry.provider().map((tool) => {
      const resolvedName = resolveProviderToolName(tool.name, options.model);
      return resolvedName === undefined ? tool : { ...tool, nativeName: resolvedName };
    });

  if (!requestedWebSearch || resolveProviderToolName("web_search", options.model) !== undefined) {
    return {
      registry,
      executable: () => registry.executable(),
      provider: resolveProviderTools,
      get: (name) => registry.get(name),
    };
  }

  const fallback = options.configuration.webSearchFallback;
  if (!fallback) {
    throw new AxleError(
      `Provider ${options.provider.name} does not support native web_search and no Axle webSearchFallback is configured`,
      {
        code: "WEB_SEARCH_FALLBACK_NOT_CONFIGURED",
        details: { provider: options.provider.name, model: options.model },
      },
    );
  }

  if (requestedWebSearch.config) {
    options.span?.warn("web_search provider config ignored by fallback backend", {
      provider: options.provider.name,
      model: options.model,
      backend: fallback.name,
    });
  }
  options.span?.info("Using web search fallback backend", {
    provider: options.provider.name,
    model: options.model,
    backend: fallback.name,
  });

  const fallbackTool = createWebSearchFallbackTool(fallback);
  return {
    registry,
    executable: () => [
      ...registry.executable().filter((tool) => tool.name !== "web_search"),
      fallbackTool,
    ],
    provider: () => resolveProviderTools().filter((tool) => tool.name !== "web_search"),
    get: (name) => (name === "web_search" ? fallbackTool : registry.get(name)),
  };
}

type ToolExecutionSource = ToolRegistry | ResolvedTools;

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

  const registry = source instanceof ToolRegistry ? source : source.registry;
  const tool = source.get(call.name);
  const toolSpan = span?.startSpan(call.name, { type: "tool" });
  let usage: Stats | undefined;
  const ctx: ToolContext = {
    signal,
    span: toolSpan,
    registry,
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
