import { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { AnyStreamChunk } from "../../messages/streaming/types.js";
import { AxleStopReason } from "../types.js";

export function createResponsesAPIStreamingAdapter() {
  let messageId = "";
  let model = "";
  let contentIndex = 0;
  let toolCallIndex = 0;
  let thinkingIndex = 0;
  const toolCallBuffers = new Map<
    string,
    {
      id: string;
      name: string;
      argumentsBuffer: string;
    }
  >();
  const thinkingItems = new Set<string>();

  function handleEvent(event: ResponseStreamEvent): Array<AnyStreamChunk> {
    const chunks: Array<AnyStreamChunk> = [];
    switch (event.type) {
      case "response.created": {
        messageId = event.response.id || `openai-${Date.now()}`;
        model = event.response.model;
        chunks.push({
          type: "start",
          id: messageId,
          data: { model, timestamp: Date.now() },
        });
        break;
      }

      case "response.output_text.delta": {
        chunks.push({
          type: "text",
          data: { text: event.delta, index: contentIndex },
        });
        break;
      }

      case "response.function_call_arguments.delta": {
        const itemId = event.item_id;

        if (!toolCallBuffers.has(itemId)) {
          toolCallIndex++;
          toolCallBuffers.set(itemId, {
            id: itemId,
            name: "",
            argumentsBuffer: "",
          });

          chunks.push({
            type: "tool-call-start",
            data: {
              index: toolCallIndex,
              id: itemId,
              name: "",
            },
          });
        }

        const buffer = toolCallBuffers.get(itemId)!;
        buffer.argumentsBuffer += event.delta;
        break;
      }

      case "response.function_call_arguments.done": {
        const itemId = event.item_id;
        const buffer = toolCallBuffers.get(itemId);

        if (buffer) {
          try {
            const parsedArgs = JSON.parse(event.arguments);
            chunks.push({
              type: "tool-call-complete",
              data: {
                index: toolCallIndex,
                id: itemId,
                name: event.name,
                arguments: parsedArgs,
              },
            });
          } catch (e) {
            throw new Error(
              `Failed to parse function call arguments for ${event.name}: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
          toolCallBuffers.delete(itemId);
        }
        break;
      }

      case "response.completed": {
        const usage = event.response.usage;
        chunks.push({
          type: "complete",
          data: {
            finishReason: event.response.incomplete_details
              ? AxleStopReason.Error
              : AxleStopReason.Stop,
            usage: {
              in: usage?.input_tokens || 0,
              out: usage?.output_tokens || 0,
            },
          },
        });
        break;
      }

      case "response.failed": {
        chunks.push({
          type: "error",
          data: {
            type: "RESPONSES_API_ERROR",
            message: `Response failed: ${event.response.status}`,
            raw: event,
          },
        });
        break;
      }

      case "response.output_item.added": {
        if (event.item?.type === "reasoning") {
          const itemId = event.item.id;
          thinkingItems.add(itemId);
          thinkingIndex++;

          chunks.push({
            type: "thinking-start",
            data: {
              index: thinkingIndex,
            },
          });
        }
        break;
      }

      case "response.reasoning_text.delta": {
        if (event.delta) {
          chunks.push({
            type: "thinking-delta",
            data: {
              index: thinkingIndex,
              text: event.delta,
            },
          });
        }
        break;
      }

      case "response.reasoning_summary_text.delta": {
        if (event.delta) {
          chunks.push({
            type: "thinking-delta",
            data: {
              index: thinkingIndex,
              text: event.delta,
            },
          });
        }
        break;
      }

      case "response.output_item.done": {
        if (event.item?.type === "reasoning") {
          const itemId = event.item.id;
          thinkingItems.delete(itemId);
        }
        break;
      }
    }

    return chunks;
  }

  return { handleEvent };
}
