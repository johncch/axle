import { MessageStreamEvent } from "@anthropic-ai/sdk/resources/messages.js";
import { AnyStreamChunk } from "../../messages/stream.js";
import { convertStopReason } from "./utils.js";

export function createAnthropicStreamingAdapter() {
  const blockTypes = new Map<number, "text" | "thinking" | "tool" | "internal-tool">();
  const internalToolInfo = new Map<string, { index: number; name: string }>();
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
          blockTypes.set(event.index, "text");
          chunks.push({
            type: "text-start",
            data: { index: event.index },
          });
        } else if (event.content_block.type === "tool_use") {
          blockTypes.set(event.index, "tool");
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
          blockTypes.set(event.index, "thinking");
          chunks.push({
            type: "thinking-start",
            data: {
              index: event.index,
              redacted: false,
            },
          });
        } else if (event.content_block.type === "redacted_thinking") {
          blockTypes.set(event.index, "thinking");
          chunks.push({
            type: "thinking-start",
            data: {
              index: event.index,
              redacted: true,
            },
          });
        } else if (event.content_block.type === "server_tool_use") {
          blockTypes.set(event.index, "internal-tool");
          const block = event.content_block;
          internalToolInfo.set(block.id, { index: event.index, name: block.name });
          chunks.push({
            type: "internal-tool-start",
            data: {
              index: event.index,
              id: block.id,
              name: block.name,
            },
          });
        } else if (event.content_block.type === "web_search_tool_result") {
          const block = event.content_block;
          const info = internalToolInfo.get(block.tool_use_id);
          if (info) {
            chunks.push({
              type: "internal-tool-complete",
              data: {
                index: info.index,
                id: block.tool_use_id,
                name: info.name,
                output: block.content,
              },
            });
            internalToolInfo.delete(block.tool_use_id);
          }
        }
        break;

      case "content_block_delta":
        if (event.delta.type === "text_delta") {
          chunks.push({
            type: "text-delta",
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

      case "content_block_stop": {
        const blockType = blockTypes.get(event.index);

        if (blockType === "text") {
          chunks.push({ type: "text-complete", data: { index: event.index } });
        } else if (blockType === "thinking") {
          chunks.push({ type: "thinking-complete", data: { index: event.index } });
        } else if (blockType === "internal-tool") {
          // Completion already emitted via web_search_tool_result
        } else if (blockType === "tool") {
          const buffer = toolCallBuffers.get(event.index);
          if (buffer) {
            try {
              const parsedArgs = buffer.argumentsBuffer ? JSON.parse(buffer.argumentsBuffer) : {};
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
              throw new Error(
                `Failed to parse tool call arguments for ${buffer.name}: ${e instanceof Error ? e.message : String(e)}\nRaw buffer: ${buffer.argumentsBuffer}`,
              );
            }
            toolCallBuffers.delete(event.index);
          }
        }

        blockTypes.delete(event.index);
        break;
      }
    }

    return chunks;
  }

  return { handleEvent };
}
