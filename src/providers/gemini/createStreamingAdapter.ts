import { FinishReason, GenerateContentResponse } from "@google/genai";
import { AnyStreamChunk } from "../../messages/stream.js";
import { AxleStopReason } from "../types.js";
import { convertStopReason } from "./utils.js";

export function createGeminiStreamingAdapter() {
  let partIndex = 0;
  let currentPartIndex = -1;
  let hasFunctionCalls = false;
  let messageId = "";
  let model = "";
  let inputTokens = 0;
  let outputTokens = 0;

  let activePart: "text" | "thinking" | null = null;

  function closeActivePart(chunks: Array<AnyStreamChunk>) {
    if (currentPartIndex < 0) return;
    if (activePart === "text") {
      chunks.push({ type: "text-complete", data: { index: currentPartIndex } });
    } else if (activePart === "thinking") {
      chunks.push({ type: "thinking-complete", data: { index: currentPartIndex } });
    }
    activePart = null;
    currentPartIndex = -1;
  }

  function handleChunk(chunk: GenerateContentResponse): Array<AnyStreamChunk> {
    const chunks: Array<AnyStreamChunk> = [];

    // First chunk - extract metadata
    if (!messageId) {
      messageId = chunk.responseId || `gemini-${Date.now()}`;
      model = chunk.modelVersion || "gemini";
      chunks.push({
        type: "start",
        id: messageId,
        data: { model, timestamp: Date.now() },
      });
    }

    // Update usage metadata if available
    if (chunk.usageMetadata) {
      inputTokens = chunk.usageMetadata.promptTokenCount || 0;
      outputTokens = (chunk.usageMetadata.totalTokenCount || 0) - inputTokens;
    }

    // Process candidates
    const candidate = chunk.candidates?.[0];
    if (!candidate) return chunks;

    const parts = candidate.content?.parts || [];

    for (const part of parts) {
      const isThought = "thought" in part && (part as { thought?: boolean }).thought === true;

      // Handle thinking content
      if (isThought && part.text) {
        if (activePart !== "thinking") {
          closeActivePart(chunks);
          currentPartIndex = partIndex++;
          activePart = "thinking";
          chunks.push({
            type: "thinking-start",
            data: { index: currentPartIndex },
          });
        }

        chunks.push({
          type: "thinking-delta",
          data: { index: currentPartIndex, text: part.text },
        });
      }
      // Handle regular text content
      else if (part.text && !isThought) {
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
          data: { text: part.text, index: currentPartIndex },
        });
      }

      // Log unrecognized parts
      else if (!part.functionCall) {
        console.log(`[gemini] unhandled part type: ${JSON.stringify(Object.keys(part))}`);
      }

      // Handle function calls (buffered by Google AI, not streamed incrementally)
      if (part.functionCall) {
        closeActivePart(chunks);
        hasFunctionCalls = true;
        const toolIdx = partIndex++;
        const toolCallId = part.functionCall.id || `tool-${toolIdx}`;

        chunks.push({
          type: "tool-call-start",
          data: {
            index: toolIdx,
            id: toolCallId,
            name: part.functionCall.name,
          },
        });

        const completeData: any = {
          index: toolIdx,
          id: toolCallId,
          name: part.functionCall.name,
          arguments: part.functionCall.args,
        };
        const rawPart = part as Record<string, unknown>;
        if (rawPart.thoughtSignature) {
          completeData.providerMetadata = { thoughtSignature: rawPart.thoughtSignature };
        }

        chunks.push({
          type: "tool-call-complete",
          data: completeData,
        });
      }
    }

    // Check for completion (FINISH_REASON_UNSPECIFIED means still streaming)
    if (
      candidate.finishReason &&
      candidate.finishReason !== FinishReason.FINISH_REASON_UNSPECIFIED
    ) {
      closeActivePart(chunks);
      const [success, baseStopReason] = convertStopReason(candidate.finishReason);
      const stopReason = hasFunctionCalls ? AxleStopReason.FunctionCall : baseStopReason;

      if (!success && !hasFunctionCalls) {
        chunks.push({
          type: "error",
          data: {
            type: "FinishReasonError",
            message: `Unexpected finish reason: ${candidate.finishReason}`,
            usage: { in: inputTokens, out: outputTokens },
            raw: chunk,
          },
        });
      } else {
        chunks.push({
          type: "complete",
          data: {
            finishReason: stopReason,
            usage: { in: inputTokens, out: outputTokens },
          },
        });
      }
    }

    return chunks;
  }

  return { handleChunk };
}
