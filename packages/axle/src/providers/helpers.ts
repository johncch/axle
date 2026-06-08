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
import type { ExecutableTool, ProviderTool, ToolContext } from "../tools/types.js";
import type { Stats } from "../types.js";
import { addStats } from "../utils/stats.js";
import type { ModelError, ModelResult } from "./types.js";

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

export type GenerateError =
  | { kind: "model"; error: ModelError }
  | { kind: "tool"; error: { name: string; message: string } }
  | { kind: "parse"; error: unknown; message: string };

export type GenerateResult<TResponse = AxleAssistantMessage> =
  | {
      ok: true;
      response: TResponse;
      messages: AxleMessage[];
      final: AxleAssistantMessage;
      usage?: Stats;
    }
  | {
      ok: false;
      response?: undefined;
      final?: AxleAssistantMessage;
      messages: AxleMessage[];
      error: GenerateError;
      usage?: Stats;
    };

export type StreamResult<TResponse = AxleAssistantMessage> = GenerateResult<TResponse>;

export function appendUsage(total: Stats, result: ModelResult): void {
  addStats(total, result.usage);
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
  if (options.registry) return options.registry;
  return new ToolRegistry({ tools: options.tools, providerTools: options.providerTools });
}

export async function executeToolCalls(
  toolCalls: ContentPartToolCall[],
  onToolCall: ToolCallCallback = async () => null,
  signal: AbortSignal,
  registry: ToolRegistry,
  span?: Span,
): Promise<{ results: AxleToolCallResult[] }> {
  const results: AxleToolCallResult[] = [];

  const throwAbortError = (): never => {
    throw new AxleAbortError("Operation aborted", { reason: signal.reason });
  };

  for (const call of toolCalls) {
    if (signal.aborted) {
      throwAbortError();
    }
    const toolSpan = span?.startSpan(call.name, { type: "tool" });
    const ctx: ToolContext = { signal, span: toolSpan, registry, emit: () => {} };
    let resolved: ToolCallResult | null | undefined;

    try {
      resolved = await onToolCall(call.name, call.parameters, ctx);
      if (signal.aborted) {
        toolSpan?.end("ok");
        throwAbortError();
      }
    } catch (error) {
      if (error instanceof AxleToolFatalError) {
        toolSpan?.setResult({
          kind: "tool",
          name: call.name,
          input: call.parameters,
          output: { type: "fatal", message: error.message },
        });
        toolSpan?.end("error");
        throw error;
      }
      if (
        signal.aborted ||
        error instanceof AxleAbortError ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        toolSpan?.end("ok");
        throwAbortError();
      }
      resolved = {
        type: "error",
        error: {
          type: "exception",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }

    if (resolved == null) {
      const tool = registry.get(call.name);
      if (tool) {
        try {
          const content = await tool.execute(call.parameters, ctx);
          toolSpan?.setResult({
            kind: "tool",
            name: call.name,
            input: call.parameters,
            output: content,
          });
          toolSpan?.end("ok");
          results.push({
            id: call.id,
            name: call.name,
            content,
          });
          continue;
        } catch (error) {
          if (error instanceof AxleToolFatalError) {
            toolSpan?.setResult({
              kind: "tool",
              name: call.name,
              input: call.parameters,
              output: { type: "fatal", message: error.message },
            });
            toolSpan?.end("error");
            throw error;
          }
          if (
            signal.aborted ||
            error instanceof AxleAbortError ||
            (error instanceof Error && error.name === "AbortError")
          ) {
            toolSpan?.end("ok");
            throwAbortError();
          }
          resolved = {
            type: "error",
            error: {
              type: "execution",
              message: error instanceof Error ? error.message : String(error),
            },
          };
        }
      }
    }

    if (resolved == null) {
      const message = `Tool not found: ${call.name}`;
      toolSpan?.setResult({
        kind: "tool",
        name: call.name,
        input: call.parameters,
        output: { type: "not-found", message },
      });
      toolSpan?.end("error");
      results.push({
        id: call.id,
        name: call.name,
        content: serializeToolError({ type: "not-found", message }),
        isError: true,
      });
      continue;
    }

    if (resolved.type === "success") {
      toolSpan?.setResult({
        kind: "tool",
        name: call.name,
        input: call.parameters,
        output: resolved.content,
      });
      toolSpan?.end("ok");
      results.push({
        id: call.id,
        name: call.name,
        content: resolved.content,
      });
    } else {
      toolSpan?.setResult({
        kind: "tool",
        name: call.name,
        input: call.parameters,
        output: resolved.error,
      });
      toolSpan?.end("error");
      results.push({
        id: call.id,
        name: call.name,
        content: serializeToolError(resolved.error),
        isError: true,
      });
    }
  }

  return { results };
}
