import { AnyStreamChunk } from "../../messages/streaming/types.js";
import { AxleStopReason } from "../types.js";

interface OllamaStreamChunk {
  model: string;
  created_at: string;
  message?: {
    role: string;
    content: string;
    thinking?: string;
    tool_calls?: Array<{
      id?: string;
      function: {
        name: string;
        arguments: unknown;
      };
    }>;
  };
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export function createOllamaStreamingAdapter() {
  let messageId = "";
  let contentIndex = 0;
  let thinkingIndex = -1;
  let toolCallIndex = 0;

  function handleChunk(chunk: OllamaStreamChunk): Array<AnyStreamChunk> {
    const chunks: Array<AnyStreamChunk> = [];

    // First chunk
    if (!messageId) {
      messageId = `ollama-${Date.now()}`;
      chunks.push({
        type: "start",
        id: messageId,
        data: { model: chunk.model, timestamp: Date.now() },
      });
    }

    // Thinking content (reasoning trace)
    if (chunk.message?.thinking) {
      if (thinkingIndex === -1) {
        // First thinking chunk - emit thinking-start
        thinkingIndex = contentIndex + 1;
        chunks.push({
          type: "thinking-start",
          data: {
            index: thinkingIndex,
          },
        });
      }

      // Emit thinking delta
      chunks.push({
        type: "thinking-delta",
        data: {
          index: thinkingIndex,
          text: chunk.message.thinking,
        },
      });
    }

    // Text content (final answer)
    if (chunk.message?.content) {
      chunks.push({
        type: "text",
        data: { text: chunk.message.content, index: contentIndex },
      });
    }

    // Tool calls (Ollama sends complete tool calls in streaming)
    if (chunk.message?.tool_calls) {
      for (const toolCall of chunk.message.tool_calls) {
        toolCallIndex++;
        const toolId = toolCall.id || `tool-${toolCallIndex}`;

        // Validate that arguments is an object
        if (
          typeof toolCall.function.arguments !== "object" ||
          toolCall.function.arguments === null ||
          Array.isArray(toolCall.function.arguments)
        ) {
          throw new Error(
            `Invalid tool call arguments for ${toolCall.function.name}: expected object, got ${typeof toolCall.function.arguments}`,
          );
        }

        chunks.push({
          type: "tool-call-start",
          data: {
            index: toolCallIndex,
            id: toolId,
            name: toolCall.function.name,
          },
        });

        chunks.push({
          type: "tool-call-complete",
          data: {
            index: toolCallIndex,
            id: toolId,
            name: toolCall.function.name,
            arguments: toolCall.function.arguments,
          },
        });
      }
    }

    // Final chunk
    if (chunk.done) {
      const finishReason = convertStopReason(chunk.done_reason);
      chunks.push({
        type: "complete",
        data: {
          finishReason,
          usage: {
            in: chunk.prompt_eval_count || 0,
            out: chunk.eval_count || 0,
          },
        },
      });
    }

    return chunks;
  }

  return { handleChunk };
}

function convertStopReason(doneReason?: string): AxleStopReason {
  switch (doneReason) {
    case "stop":
      return AxleStopReason.Stop;
    case "length":
      return AxleStopReason.Length;
    default:
      return AxleStopReason.Stop;
  }
}
