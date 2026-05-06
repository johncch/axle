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
      const partKeys = Object.keys(part);
      const isSignatureOnly =
        ("thoughtSignature" in part && !part.text && !part.functionCall) ||
        (partKeys.length === 2 && "text" in part && "thoughtSignature" in part && !part.text);

      // Signatures are caching/verification metadata; we don't carry them
      // forward today, so skip silently rather than tripping the unhandled log.
      if (isSignatureOnly) continue;

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
        const toolName = part.functionCall.name ?? "";

        chunks.push({
          type: "tool-call-start",
          data: {
            index: toolIdx,
            id: toolCallId,
            name: toolName,
          },
        });

        // Gemini delivers args as a complete object, not as a stream. Emit
        // a single synthetic args-delta with the full JSON so consumers get
        // a uniform delta event surface across providers.
        const args = part.functionCall.args ?? {};
        const argsJson = JSON.stringify(args);
        chunks.push({
          type: "tool-call-args-delta",
          data: {
            index: toolIdx,
            id: toolCallId,
            name: toolName,
            delta: argsJson,
            accumulated: argsJson,
          },
        });

        const completeData: any = {
          index: toolIdx,
          id: toolCallId,
          name: toolName,
          arguments: args,
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
