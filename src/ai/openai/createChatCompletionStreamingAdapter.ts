import OpenAI from "openai";
import { AnyStreamChunk } from "../../messages/streaming/types.js";
import { AxleStopReason } from "../types.js";

export function createChatCompletionStreamingAdapter() {
  const toolCallBuffers = new Map<
    number,
    {
      id: string;
      name: string;
      argumentsBuffer: string;
    }
  >();
  let contentIndex = 0;
  let messageId = "";
  let model = "";

  function handleChunk(chunk: OpenAI.Chat.Completions.ChatCompletionChunk): Array<AnyStreamChunk> {
    const chunks: Array<AnyStreamChunk> = [];
    const choice = chunk.choices[0];
    if (!choice) return chunks;

    // First chunk
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

    // Text content
    if (delta.content) {
      chunks.push({
        type: "text",
        data: { text: delta.content, index: contentIndex },
      });
    }

    // Tool calls
    if (delta.tool_calls) {
      for (const toolCallDelta of delta.tool_calls) {
        const index = toolCallDelta.index;

        // Start new tool call
        if (!toolCallBuffers.has(index)) {
          const toolCallIndex = contentIndex + index + 1;
          const toolId = toolCallDelta.id || `tool-${toolCallIndex}`;
          toolCallBuffers.set(index, {
            id: toolId,
            name: toolCallDelta.function?.name || "",
            argumentsBuffer: "",
          });

          chunks.push({
            type: "tool-call-start",
            data: {
              index: toolCallIndex,
              id: toolId,
              name: toolCallDelta.function?.name || "",
            },
          });
        }

        // Accumulate arguments
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
      // Complete any pending tool calls
      for (const [index, buffer] of toolCallBuffers) {
        const toolCallIndex = contentIndex + index + 1;
        try {
          const parsedArgs = JSON.parse(buffer.argumentsBuffer);
          chunks.push({
            type: "tool-call-complete",
            data: {
              index: toolCallIndex,
              id: buffer.id,
              name: buffer.name,
              arguments: parsedArgs,
            },
          });
        } catch (e) {
          console.warn(`Failed to parse tool call arguments for ${buffer.name}:`, e);
        }
      }

      const finishReason = convertFinishReason(choice.finish_reason);
      chunks.push({
        type: "complete",
        data: {
          finishReason,
          usage: chunk.usage
            ? {
                in: chunk.usage.prompt_tokens,
                out: chunk.usage.completion_tokens,
              }
            : { in: 0, out: 0 },
        },
      });
    }

    return chunks;
  }

  return { handleChunk };
}

function convertFinishReason(
  finishReason: string | null,
): AxleStopReason {
  switch (finishReason) {
    case "stop":
      return AxleStopReason.Stop;
    case "length":
      return AxleStopReason.Length;
    case "tool_calls":
    case "function_call":
      return AxleStopReason.FunctionCall;
    case "content_filter":
      return AxleStopReason.Error;
    default:
      return AxleStopReason.Stop;
  }
}
