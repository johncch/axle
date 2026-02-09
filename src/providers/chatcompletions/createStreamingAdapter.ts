import { AnyStreamChunk } from "../../messages/streaming/types.js";
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
  let currentTextIndex = -1;
  let messageId = "";
  let model = "";
  let currentThinkingIndex = -1;

  function handleChunk(chunk: ChatCompletionChunk): Array<AnyStreamChunk> {
    const chunks: Array<AnyStreamChunk> = [];
    const choice = chunk.choices[0];
    if (!choice) {
      // Usage-only chunk at the end of stream (no choices)
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
      if (currentThinkingIndex === -1) {
        currentThinkingIndex = partIndex++;
        chunks.push({
          type: "thinking-start",
          data: { index: currentThinkingIndex },
        });
      }

      chunks.push({
        type: "thinking-delta",
        data: { index: currentThinkingIndex, text: delta.reasoning_content },
      });
    }

    // Text content
    if (delta.content) {
      if (currentTextIndex === -1) {
        currentTextIndex = partIndex++;
      }

      chunks.push({
        type: "text-delta",
        data: { text: delta.content, index: currentTextIndex },
      });
    }

    // Tool calls
    if (delta.tool_calls) {
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

    // Completion
    if (choice.finish_reason) {
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

      const finishReason = convertFinishReason(choice.finish_reason);
      chunks.push({
        type: "complete",
        data: {
          finishReason,
          usage: chunk.usage
            ? { in: chunk.usage.prompt_tokens, out: chunk.usage.completion_tokens }
            : { in: 0, out: 0 },
        },
      });
    }

    return chunks;
  }

  return { handleChunk };
}
