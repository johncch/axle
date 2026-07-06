import type {
  AxleAssistantMessage,
  ContentPartProviderTool,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
} from "../../messages/message.js";
import type { AnyStreamChunk } from "../../messages/stream.js";
import type { Stats } from "../../types.js";
import { createStats } from "../../utils/stats.js";
import type { ResolvedTools } from "../helpers.js";
import type { StreamEvent } from "../stream.js";
import { AxleStopReason } from "../types.js";

export type ToolCallArgumentError = {
  type: string;
  message: string;
  raw?: string;
};

export type AssistantContentPart = AxleAssistantMessage["content"][number];

export interface TurnReaderContext {
  /** Deliver a StreamEvent to the stream's subscribers. */
  emit(event: StreamEvent): void;
  /** Registry-resolved tools, for the kind on `tool:request` events. */
  tools: ResolvedTools;
  signal: AbortSignal;
}

/** A settled model turn: every content part closed, finish reason known. */
export interface CompletedTurn {
  kind: "complete";
  id: string;
  model: string;
  parts: AssistantContentPart[];
  finishReason: AxleStopReason;
  usage: Stats;
  /** Tool call id → argument parse error, surfaced as synthetic tool errors. */
  toolCallArgumentErrors: Map<string, ToolCallArgumentError>;
}

export type TurnReadOutcome =
  | CompletedTurn
  | { kind: "aborted"; partial?: AxleAssistantMessage }
  | { kind: "incomplete" }
  | { kind: "provider-error"; errorType: string; message: string; usage?: Stats; model: string };

/**
 * Consume one model turn from a provider chunk stream, translating chunks
 * into StreamEvents and accumulating the turn's content parts.
 *
 * This is a pure per-turn state machine: it owns no conversation state,
 * touches no spans, and makes no decisions about what happens next. The
 * caller maps the outcome onto the tool loop — including wrapping `aborted`
 * partials and `provider-error` usage into its own accounting.
 */
export async function readTurn(
  source: AsyncIterable<AnyStreamChunk>,
  ctx: TurnReaderContext,
): Promise<TurnReadOutcome> {
  const parts: AssistantContentPart[] = [];
  let turnId = "";
  let turnModel = "";
  let finishReason: AxleStopReason | null = null;
  let usage: Stats = createStats();

  let openPartType: "text" | "thinking" | null = null;
  let openAccumulated: string = "";

  const toolCallArgumentErrors = new Map<string, ToolCallArgumentError>();
  const chunkIndexToPartIndex = new Map<number, number>();

  // Some chat-completions vendors stream the first tool_call delta before
  // the function name is known. tool:request carries the name and the
  // registry-resolved kind, so its emission is deferred until then.
  const pendingToolRequests = new Set<string>();
  const emitToolRequest = (id: string, name: string) => {
    ctx.emit({
      type: "tool:request",
      id,
      name,
      kind: ctx.tools.get(name)?.kind ?? "tool",
    });
  };

  // Index of the most recently pushed parts entry.
  // Provider block indices can have gaps (e.g. web_search_tool_result), but
  // blocks stream sequentially so the current part is always the last pushed.
  let currentPartIndex = -1;

  const closePart = () => {
    if (openPartType !== null) {
      const endType = openPartType === "text" ? ("text:end" as const) : ("thinking:end" as const);
      ctx.emit({ type: endType, final: openAccumulated });
      openPartType = null;
      openAccumulated = "";
    }
  };

  for await (const chunk of source) {
    switch (chunk.type) {
      case "start":
        turnId = chunk.id;
        turnModel = chunk.data.model;
        ctx.emit({ type: "turn:start", id: turnId, model: turnModel });
        break;

      case "text-start": {
        closePart();
        parts.push({ type: "text", text: "" });
        currentPartIndex = parts.length - 1;
        chunkIndexToPartIndex.set(chunk.data.index, currentPartIndex);
        openPartType = "text";
        openAccumulated = "";
        ctx.emit({ type: "text:start" });
        break;
      }

      case "text-delta": {
        const part = parts[currentPartIndex] as ContentPartText;
        part.text += chunk.data.text;
        openAccumulated = part.text;
        ctx.emit({
          type: "text:delta",
          delta: chunk.data.text,
          accumulated: openAccumulated,
        });
        break;
      }

      case "text-citation": {
        const partIndex = chunkIndexToPartIndex.get(chunk.data.index) ?? currentPartIndex;
        const part = parts[partIndex] as ContentPartText;
        if (!part || part.type !== "text") break;
        part.citations = [...(part.citations ?? []), chunk.data.citation];
        ctx.emit({
          type: "text:citation",
          citation: chunk.data.citation,
          citations: part.citations,
        });
        break;
      }

      case "citation": {
        closePart();
        parts.push({
          type: "citation",
          citations: chunk.data.citations,
          ...(chunk.data.providerMetadata ? { providerMetadata: chunk.data.providerMetadata } : {}),
        });
        currentPartIndex = parts.length - 1;
        chunkIndexToPartIndex.set(chunk.data.index, currentPartIndex);
        ctx.emit({
          type: "citation",
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
        parts.push({
          type: "thinking",
          text: "",
          ...(chunk.data.id ? { id: chunk.data.id } : {}),
          ...(chunk.data.redacted !== undefined ? { redacted: chunk.data.redacted } : {}),
          ...(chunk.data.continuity ? { continuity: chunk.data.continuity } : {}),
          ...(chunk.data.providerMetadata ? { providerMetadata: chunk.data.providerMetadata } : {}),
        });
        currentPartIndex = parts.length - 1;
        chunkIndexToPartIndex.set(chunk.data.index, currentPartIndex);
        openPartType = "thinking";
        openAccumulated = "";
        ctx.emit({
          type: "thinking:start",
          redacted: chunk.data.redacted,
          continuity: chunk.data.continuity,
          providerMetadata: chunk.data.providerMetadata,
        });
        break;
      }

      case "thinking-delta": {
        const part = parts[currentPartIndex] as ContentPartThinking;
        part.text = (part.text ?? "") + chunk.data.text;
        openAccumulated = part.text;
        ctx.emit({
          type: "thinking:delta",
          delta: chunk.data.text,
          accumulated: openAccumulated,
        });
        break;
      }

      case "thinking-summary-delta": {
        const part = parts[currentPartIndex] as ContentPartThinking;
        part.summary = (part.summary ?? "") + chunk.data.text;
        openAccumulated = part.summary;
        ctx.emit({
          type: "thinking:summary-delta",
          delta: chunk.data.text,
          accumulated: openAccumulated,
        });
        break;
      }

      case "thinking-metadata": {
        const partIndex = chunkIndexToPartIndex.get(chunk.data.index) ?? currentPartIndex;
        const part = parts[partIndex] as ContentPartThinking;
        if (!part || part.type !== "thinking") break;
        if (chunk.data.redacted !== undefined) part.redacted = chunk.data.redacted;
        if (chunk.data.continuity) part.continuity = chunk.data.continuity;
        if (chunk.data.providerMetadata) part.providerMetadata = chunk.data.providerMetadata;
        ctx.emit({
          type: "thinking:update",
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
        parts.push({
          type: "tool-call",
          id: chunk.data.id,
          name: chunk.data.name,
          parameters: {},
        });
        currentPartIndex = parts.length - 1;
        chunkIndexToPartIndex.set(chunk.data.index, currentPartIndex);
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
        ctx.emit({
          type: "tool:args-delta",
          id: chunk.data.id,
          name: chunk.data.name,
          delta: chunk.data.delta,
          accumulated: chunk.data.accumulated,
        });
        break;
      }

      case "tool-call-complete": {
        const targetIndex = chunkIndexToPartIndex.get(chunk.data.index) ?? currentPartIndex;
        const part = parts[targetIndex] as ContentPartToolCall;
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
        parts.push({
          type: "provider-tool",
          id: chunk.data.id,
          name: chunk.data.name,
        });
        currentPartIndex = parts.length - 1;
        chunkIndexToPartIndex.set(chunk.data.index, currentPartIndex);
        ctx.emit({
          type: "provider-tool:start",
          id: chunk.data.id,
          name: chunk.data.name,
        });
        break;
      }

      case "provider-tool-complete": {
        const partIndex = chunkIndexToPartIndex.get(chunk.data.index) ?? currentPartIndex;
        const part = parts[partIndex] as ContentPartProviderTool;
        if (part && part.type === "provider-tool" && chunk.data.output != null) {
          part.output = chunk.data.output;
        }
        ctx.emit({
          type: "provider-tool:complete",
          id: chunk.data.id,
          name: chunk.data.name,
          output: chunk.data.output,
        });
        break;
      }

      case "complete": {
        closePart();
        finishReason = chunk.data.finishReason;
        usage = chunk.data.usage;
        break;
      }

      case "error": {
        closePart();
        return {
          kind: "provider-error",
          errorType: chunk.data.type,
          message: chunk.data.message,
          usage: chunk.data.usage,
          model: turnModel,
        };
      }

      default:
        console.warn(`[WARN] Unhandled chunk type. Should never happen`);
    }

    if (ctx.signal.aborted) break;
  }

  if (ctx.signal.aborted) {
    closePart();
    const partial: AxleAssistantMessage | undefined = parts.length
      ? {
          role: "assistant",
          id: turnId,
          model: turnModel,
          content: parts,
          finishReason: AxleStopReason.Cancelled,
        }
      : undefined;
    return { kind: "aborted", partial };
  }

  // Stream ended without a complete chunk — connection dropped or provider bug
  if (finishReason === null) {
    closePart();
    return { kind: "incomplete" };
  }

  return {
    kind: "complete",
    id: turnId,
    model: turnModel,
    parts,
    finishReason,
    usage,
    toolCallArgumentErrors,
  };
}
