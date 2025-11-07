import { MessageStreamEvent } from "@anthropic-ai/sdk/resources/messages.js";
import { AnyStreamChunk } from "../../messages/streaming/types.js";
import { convertStopReason } from "./utils.js";

export function createAnthropicStreamingAdapter() {
  let currentContentIndex = 0;
  const toolCallBuffers = new Map<
    number,
    {
      id: string;
      name: string;
      argumentsBuffer: string;
    }
  >();

  function handleEvent(event: MessageStreamEvent): Array<AnyStreamChunk> {
    const chunks: Array<AnyStreamChunk> = [];

    switch (event.type) {
      case "message_start":
        chunks.push({
          type: "start",
          id: event.message.id,
          data: {
            model: event.message.model,
            timestamp: Date.now(),
          },
        });
        break;

      case "message_delta":
        if (event.delta.stop_reason) {
          chunks.push({
            type: "complete",
            data: {
              finishReason: convertStopReason(event.delta.stop_reason),
              usage: event.usage
                ? {
                    in: event.usage.input_tokens || 0,
                    out: event.usage.output_tokens || 0,
                  }
                : undefined,
            },
          });
        }

      case "message_stop":
        // No action taken
        break;

      case "content_block_start":
        if (event.content_block.type === "text") {
          currentContentIndex = event.index;
        } else if (event.content_block.type === "tool_use") {
          const toolBlock = event.content_block;
          toolCallBuffers.set(event.index, {
            id: toolBlock.id,
            name: toolBlock.name,
            argumentsBuffer: "",
          });

          chunks.push({
            type: "tool-call-start",
            data: {
              index: event.index,
              id: toolBlock.id,
              name: toolBlock.name,
            },
          });
        } else if (event.content_block.type === "thinking") {
          chunks.push({
            type: "thinking-start",
            data: {
              index: event.index,
              redacted: false,
            },
          });
        } else if (event.content_block.type === "redacted_thinking") {
          chunks.push({
            type: "thinking-start",
            data: {
              index: event.index,
              redacted: true,
            },
          });
        } else if (event.content_block.type === "server_tool_use") {
          // TODO
        } else if (event.content_block.type === "web_search_tool_result") {
          // TODO
        }
        break;

      case "content_block_delta":
        if (event.delta.type === "text_delta") {
          chunks.push({
            type: "text",
            data: {
              text: event.delta.text,
              index: event.index,
            },
          });
        } else if (event.delta.type === "input_json_delta") {
          const buffer = toolCallBuffers.get(event.index);
          if (buffer) {
            buffer.argumentsBuffer += event.delta.partial_json;
          }
        } else if (event.delta.type === "thinking_delta") {
          chunks.push({
            type: "thinking-delta",
            data: {
              text: event.delta.thinking,
              index: event.index,
            },
          });
        } else if (event.delta.type === "signature_delta") {
          // TODO
        } else if (event.delta.type === "citations_delta") {
          // TODO
        }
        break;

      case "content_block_stop":
        // Check if this was a tool call and emit completion
        const buffer = toolCallBuffers.get(event.index);
        if (buffer) {
          try {
            const parsedArgs = JSON.parse(buffer.argumentsBuffer);
            chunks.push({
              type: "tool-call-complete",
              data: {
                index: event.index,
                id: buffer.id,
                name: buffer.name,
                arguments: parsedArgs,
              },
            });
          } catch (e) {
            console.warn(`Failed to parse tool call arguments for ${buffer.name}:`, e);
          }
          // Clean up buffer
          toolCallBuffers.delete(event.index);
        }
        break;

      default:
        console.warn(`Unknown Anthropic stream event type`);
    }

    return chunks;
  }

  return { handleEvent };
}
