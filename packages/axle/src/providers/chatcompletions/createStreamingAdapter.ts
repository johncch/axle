import { AnyStreamChunk } from "../../messages/stream.js";
import type { Stats } from "../../types.js";
import { truncateMiddle } from "../../utils/truncate.js";
import { AxleStopReason } from "../types.js";
import { ChatCompletionChunk, ChatCompletionReasoningDetail } from "./types.js";
import { chatUsageToStats, convertFinishReason } from "./utils.js";
import {
  isOpenRouterTextAnchoredCitation,
  normalizeOpenRouterCitation,
  reasoningDetailCarriesContinuity,
  reasoningDetailContentField,
  reasoningDetailContentText,
  reasoningDetailContinuity,
  reasoningDetailIdentity,
  type OpenRouterThinkingContinuity,
} from "./vendors/openrouter/index.js";

export function createStreamingAdapter() {
  const toolCallBuffers = new Map<
    number,
    {
      id: string;
      name: string;
      argumentsBuffer: string;
      partIdx: number;
    }
  >();
  let partIndex = 0;
  let currentPartIndex = -1;
  let messageId = "";
  let model = "";

  let activePart: "text" | "thinking" | null = null;
  let activeDetailIndex: number | undefined;
  let activeContinuity: OpenRouterThinkingContinuity | undefined;
  let sawReasoningDetails = false;

  // Deferred completion: finish_reason arrives before the usage-only chunk,
  // so we hold the complete event until finalize() is called.
  let pendingFinishReason: AxleStopReason | undefined;
  let pendingUsage: Stats | undefined;

  function closeActivePart(chunks: Array<AnyStreamChunk>) {
    if (currentPartIndex < 0) return;
    if (activePart === "text") {
      chunks.push({ type: "text-complete", data: { index: currentPartIndex } });
    } else if (activePart === "thinking") {
      chunks.push({ type: "thinking-complete", data: { index: currentPartIndex } });
    }
    activePart = null;
    currentPartIndex = -1;
    activeDetailIndex = undefined;
    activeContinuity = undefined;
  }

  function ensureThinkingPart(
    chunks: Array<AnyStreamChunk>,
    detail?: ChatCompletionReasoningDetail,
  ): { continuityChanged: boolean } {
    const openedByDetail = activeContinuity !== undefined;
    const continuesOpenBlock =
      activePart === "thinking" &&
      (detail ? openedByDetail && detail.index === activeDetailIndex : !openedByDetail);
    if (continuesOpenBlock) {
      if (!detail) return { continuityChanged: false };
      const merged = reasoningDetailContinuity(detail, activeContinuity);
      const continuityChanged = !sameContinuity(merged, activeContinuity);
      activeContinuity = merged;
      return { continuityChanged };
    }

    closeActivePart(chunks);
    currentPartIndex = partIndex++;
    activePart = "thinking";
    activeDetailIndex = detail?.index;
    activeContinuity = detail ? reasoningDetailContinuity(detail) : undefined;
    chunks.push({
      type: "thinking-start",
      data: {
        index: currentPartIndex,
        ...(detail?.id ? { id: detail.id } : {}),
        ...(detail?.type === "reasoning.encrypted" ? { redacted: true } : {}),
        ...(activeContinuity ? { continuity: activeContinuity } : {}),
        ...(detail ? { providerMetadata: reasoningDetailMetadata(detail) } : {}),
      },
    });
    return { continuityChanged: false };
  }

  function handleChunk(chunk: ChatCompletionChunk): Array<AnyStreamChunk> {
    const chunks: Array<AnyStreamChunk> = [];

    // Capture usage whenever present — some providers (e.g. OpenRouter) send it
    // on every chunk, others only on a final usage-only chunk.
    if (chunk.usage) {
      pendingUsage = chatUsageToStats(chunk.usage);
    }

    const choice = chunk.choices?.[0];
    if (!choice) {
      return chunks;
    }

    if (!messageId) {
      messageId = chunk.id;
      model = chunk.model;
      chunks.push({
        type: "start",
        id: messageId,
        data: { model, timestamp: Date.now() },
      });
    }

    const delta = choice.delta;

    if (delta.reasoning_details?.length) sawReasoningDetails = true;
    for (const detail of delta.reasoning_details ?? []) {
      const field = reasoningDetailContentField(detail);
      const text = reasoningDetailContentText(detail);
      if (detail.type === "reasoning.encrypted" && detail.data) {
        ensureThinkingPart(chunks, detail);
        chunks.push({
          type: "thinking-metadata",
          data: {
            index: currentPartIndex,
            redacted: true,
            continuity: activeContinuity,
            providerMetadata: reasoningDetailMetadata(detail),
          },
        });
        continue;
      }
      if (!(field && text) && !reasoningDetailCarriesContinuity(detail)) continue;
      const { continuityChanged } = ensureThinkingPart(chunks, detail);
      if (continuityChanged) {
        chunks.push({
          type: "thinking-metadata",
          data: { index: currentPartIndex, continuity: activeContinuity },
        });
      }
      if (field && text) {
        chunks.push({
          type: field === "summary" ? "thinking-summary-delta" : "thinking-raw-delta",
          data: { index: currentPartIndex, text },
        });
      }
    }

    const reasoningDelta = delta.reasoning_content ?? delta.reasoning;
    if (!sawReasoningDetails && reasoningDelta) {
      ensureThinkingPart(chunks);
      chunks.push({
        type: "thinking-raw-delta",
        data: { index: currentPartIndex, text: reasoningDelta },
      });
    }

    // Text content
    if (delta.content) {
      if (activePart !== "text") {
        closeActivePart(chunks);
        currentPartIndex = partIndex++;
        activePart = "text";
        chunks.push({
          type: "text-start",
          data: { index: currentPartIndex },
        });
      }

      chunks.push({
        type: "text-delta",
        data: { text: delta.content, index: currentPartIndex },
      });
    }

    if (delta.annotations) {
      const citations = delta.annotations
        .map(normalizeOpenRouterCitation)
        .filter((citation) => citation !== null);
      const textCitations =
        activePart === "text" ? citations.filter(isOpenRouterTextAnchoredCitation) : [];
      for (const citation of textCitations) {
        chunks.push({
          type: "text-citation",
          data: { index: currentPartIndex, citation },
        });
      }

      const citationPartCitations = citations.filter(
        (citation) => !textCitations.includes(citation),
      );
      if (citationPartCitations.length > 0) {
        closeActivePart(chunks);
        chunks.push({
          type: "citation",
          data: {
            index: partIndex++,
            citations: citationPartCitations,
          },
        });
      }
    }

    // Tool calls
    if (delta.tool_calls) {
      closeActivePart(chunks);

      for (const toolCallDelta of delta.tool_calls) {
        const index = toolCallDelta.index;

        if (!toolCallBuffers.has(index)) {
          const idx = partIndex++;
          const toolId = toolCallDelta.id || `tool-${idx}`;
          toolCallBuffers.set(index, {
            id: toolId,
            name: toolCallDelta.function?.name || "",
            argumentsBuffer: "",
            partIdx: idx,
          });

          chunks.push({
            type: "tool-call-start",
            data: {
              index: idx,
              id: toolId,
              name: toolCallDelta.function?.name || "",
            },
          });
        }

        const buffer = toolCallBuffers.get(index)!;
        if (toolCallDelta.id) buffer.id = toolCallDelta.id;
        if (toolCallDelta.function?.name) buffer.name = toolCallDelta.function.name;
        if (toolCallDelta.function?.arguments) {
          buffer.argumentsBuffer += toolCallDelta.function.arguments;
          chunks.push({
            type: "tool-call-args-delta",
            data: {
              index: buffer.partIdx,
              id: buffer.id,
              name: buffer.name,
              delta: toolCallDelta.function.arguments,
              accumulated: buffer.argumentsBuffer,
            },
          });
        }
      }
    }

    // Completion — defer emitting until finalize() so usage-only chunk can arrive
    if (choice.finish_reason && pendingFinishReason === undefined) {
      closeActivePart(chunks);

      // Flush pending tool calls
      for (const [, buffer] of toolCallBuffers) {
        try {
          const parsedArgs = buffer.argumentsBuffer ? JSON.parse(buffer.argumentsBuffer) : {};
          chunks.push({
            type: "tool-call-complete",
            data: {
              index: buffer.partIdx,
              id: buffer.id,
              name: buffer.name,
              arguments: parsedArgs,
            },
          });
        } catch (e) {
          const parseMessage = e instanceof Error ? e.message : String(e);
          chunks.push({
            type: "tool-call-complete",
            data: {
              index: buffer.partIdx,
              id: buffer.id,
              name: buffer.name,
              arguments: {},
              error: {
                type: "invalid-arguments",
                message: `Failed to parse tool call arguments for ${buffer.name}: ${parseMessage}`,
                raw: truncateMiddle(buffer.argumentsBuffer),
              },
            },
          });
        }
      }
      toolCallBuffers.clear();

      pendingFinishReason = convertFinishReason(choice.finish_reason);
    }

    return chunks;
  }

  function finalize(): Array<AnyStreamChunk> {
    if (pendingFinishReason === undefined) {
      if (toolCallBuffers.size === 0) return [];

      const tools = [...toolCallBuffers.values()]
        .map((buffer) => {
          const label = buffer.name || "unknown tool";
          return `${label} (${buffer.id})`;
        })
        .join(", ");

      return [
        {
          type: "error",
          data: {
            type: "IncompleteStream",
            message: `Stream ended without a completion signal while tool call arguments were still buffering for ${tools}; arguments were likely truncated or incomplete.`,
          },
        },
      ];
    }

    return [
      {
        type: "complete",
        data: {
          finishReason: pendingFinishReason,
          usage: pendingUsage ?? { in: 0, out: 0 },
        },
      },
    ];
  }

  return { handleChunk, finalize };
}

function reasoningDetailMetadata(detail: ChatCompletionReasoningDetail): Record<string, unknown> {
  return { reasoningDetail: reasoningDetailIdentity(detail) };
}

function sameContinuity(
  a: OpenRouterThinkingContinuity | undefined,
  b: OpenRouterThinkingContinuity | undefined,
): boolean {
  if (!a || !b) return a === b;
  return (
    a.type === b.type &&
    a.id === b.id &&
    a.format === b.format &&
    a.index === b.index &&
    a.signature === b.signature &&
    a.data === b.data
  );
}
