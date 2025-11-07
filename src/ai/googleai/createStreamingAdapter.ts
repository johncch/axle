import { GenerateContentResponse } from "@google/genai";
import { AnyStreamChunk } from "../../messages/streaming/types.js";
import { convertStopReason } from "./utils.js";

export function createGoogleAIStreamingAdapter() {
  let currentContentIndex = 0;
  let currentThinkingIndex = -1;
  let messageId = "";
  let model = "";
  let inputTokens = 0;
  let outputTokens = 0;

  function handleChunk(chunk: GenerateContentResponse): Array<AnyStreamChunk> {
    const chunks: Array<AnyStreamChunk> = [];

    // First chunk - extract metadata
    if (!messageId) {
      messageId = chunk.responseId || `googleai-${Date.now()}`;
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
      // Check if this is a thinking part (Gemini 2.5+ models)
      const isThought = "thought" in part && (part as { thought?: boolean }).thought === true;

      // Handle thinking content
      if (isThought && part.text) {
        if (currentThinkingIndex === -1) {
          // First thinking chunk - emit thinking-start
          currentThinkingIndex = currentContentIndex + 1;
          chunks.push({
            type: "thinking-start",
            data: {
              index: currentThinkingIndex,
              redacted: false,
            },
          });
        }

        // Emit thinking delta
        chunks.push({
          type: "thinking-delta",
          data: {
            index: currentThinkingIndex,
            text: part.text,
          },
        });
      }
      // Handle regular text content
      else if (part.text && !isThought) {
        chunks.push({
          type: "text",
          data: { text: part.text, index: currentContentIndex },
        });
      }

      // Handle function calls (buffered by Google AI, not streamed incrementally)
      if (part.functionCall) {
        currentContentIndex++;
        const toolCallId = `tool-${currentContentIndex}`;

        chunks.push({
          type: "tool-call-start",
          data: {
            index: currentContentIndex,
            id: toolCallId,
            name: part.functionCall.name,
          },
        });

        chunks.push({
          type: "tool-call-complete",
          data: {
            index: currentContentIndex,
            id: toolCallId,
            name: part.functionCall.name,
            arguments: part.functionCall.args,
          },
        });
      }
    }

    // Check for completion
    if (candidate.finishReason) {
      const [success, stopReason] = convertStopReason(candidate.finishReason);

      if (!success) {
        chunks.push({
          type: "error",
          data: {
            type: "FinishReasonError",
            message: `Unexpected finish reason: ${candidate.finishReason}`,
            usage: {
              in: inputTokens,
              out: outputTokens,
            },
            raw: chunk,
          },
        });
      } else {
        chunks.push({
          type: "complete",
          data: {
            finishReason: stopReason,
            usage: {
              in: inputTokens,
              out: outputTokens,
            },
          },
        });
      }
    }

    return chunks;
  }

  return { handleChunk };
}
