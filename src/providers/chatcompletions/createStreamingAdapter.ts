import { AnyStreamChunk } from "../../messages/stream.js";
import { AxleStopReason } from "../types.js";
import { ChatCompletionChunk } from "./types.js";
import { convertFinishReason } from "./utils.js";

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

  // Deferred completion: finish_reason arrives before the usage-only chunk,
  // so we hold the complete event until finalize() is called.
  let pendingFinishReason: AxleStopReason | undefined;
  let pendingUsage: { in: number; out: number } | undefined;

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

  function handleChunk(chunk: ChatCompletionChunk): Array<AnyStreamChunk> {
    const chunks: Array<AnyStreamChunk> = [];

    // Capture usage whenever present — some providers (e.g. OpenRouter) send it
    // on every chunk, others only on a final usage-only chunk.
    if (chunk.usage) {
      pendingUsage = { in: chunk.usage.prompt_tokens, out: chunk.usage.completion_tokens };
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

    // Reasoning content (DeepSeek, vLLM, Kimi)
    if (delta.reasoning_content) {
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
        data: { index: currentPartIndex, text: delta.reasoning_content },
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
        }
      }
    }

    // Completion — defer emitting until finalize() so usage-only chunk can arrive
    if (choice.finish_reason) {
      closeActivePart(chunks);

      // Flush pending tool calls
      for (const [, buffer] of toolCallBuffers) {
        try {
          const parsedArgs = JSON.parse(buffer.argumentsBuffer);
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
          throw new Error(
            `Failed to parse tool call arguments for ${buffer.name}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      pendingFinishReason = convertFinishReason(choice.finish_reason);
    }

    return chunks;
  }

  function finalize(): Array<AnyStreamChunk> {
    if (pendingFinishReason === undefined) return [];
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
