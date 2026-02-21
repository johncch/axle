import { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { AnyStreamChunk } from "../../messages/stream.js";
import { AxleStopReason } from "../types.js";

export function createStreamingAdapter() {
  let messageId = "";
  let model = "";
  let partIndex = 0;
  let currentPartIndex = -1;
  let hasFunctionCalls = false;
  const functionInfo = new Map<string, { name: string; callId: string }>();
  const internalToolIndices = new Map<string, number>();
  const INTERNAL_TOOL_TYPES = new Set([
    "web_search_call",
    "file_search_call",
    "code_interpreter_call",
  ]);
  const toolCallBuffers = new Map<
    string,
    {
      id: string;
      callId: string;
      name: string;
      argumentsBuffer: string;
      partIdx: number;
    }
  >();

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
        if (currentPartIndex === -1) {
          currentPartIndex = partIndex++;
          chunks.push({
            type: "text-start",
            data: { index: currentPartIndex },
          });
        }
        chunks.push({
          type: "text-delta",
          data: { text: event.delta, index: currentPartIndex },
        });
        break;
      }

      case "response.output_text.done": {
        if (currentPartIndex >= 0) {
          chunks.push({
            type: "text-complete",
            data: { index: currentPartIndex },
          });
          currentPartIndex = -1;
        }
        break;
      }

      case "response.function_call_arguments.delta": {
        const itemId = event.item_id;

        if (!toolCallBuffers.has(itemId)) {
          const info = functionInfo.get(itemId);
          const name = info?.name || "";
          const callId = info?.callId || itemId;
          const idx = partIndex++;
          toolCallBuffers.set(itemId, {
            id: itemId,
            callId,
            name,
            argumentsBuffer: "",
            partIdx: idx,
          });

          chunks.push({
            type: "tool-call-start",
            data: {
              index: idx,
              id: callId,
              name,
            },
          });
        }

        const buffer = toolCallBuffers.get(itemId)!;
        buffer.argumentsBuffer += event.delta;
        break;
      }

      case "response.function_call_arguments.done": {
        hasFunctionCalls = true;
        const itemId = event.item_id;
        const buffer = toolCallBuffers.get(itemId);
        const name = (event as any).name || buffer?.name || "";

        if (buffer) {
          try {
            const parsedArgs = event.arguments
              ? JSON.parse(event.arguments)
              : {};
            chunks.push({
              type: "tool-call-complete",
              data: {
                index: buffer.partIdx,
                id: buffer.callId,
                name,
                arguments: parsedArgs,
              },
            });
          } catch (e) {
            throw new Error(
              `Failed to parse function call arguments for ${name}: ${e instanceof Error ? e.message : String(e)}\nRaw value: ${event.arguments}`,
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
              : hasFunctionCalls
                ? AxleStopReason.FunctionCall
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
          currentPartIndex = partIndex++;
          chunks.push({
            type: "thinking-start",
            data: {
              index: currentPartIndex,
            },
          });
        } else if (event.item?.type === "function_call") {
          const item = event.item as { id?: string; name: string; call_id: string };
          const itemId = item.id || item.call_id;
          if (itemId) {
            functionInfo.set(itemId, {
              name: item.name || "",
              callId: item.call_id || itemId,
            });
          }
        } else if (event.item && INTERNAL_TOOL_TYPES.has(event.item.type)) {
          const item = event.item as { id: string; type: string };
          const idx = partIndex++;
          internalToolIndices.set(item.id, idx);
          chunks.push({
            type: "internal-tool-start",
            data: {
              index: idx,
              id: item.id,
              name: item.type,
            },
          });
        }
        break;
      }

      case "response.output_item.done": {
        if (event.item?.type === "reasoning" && currentPartIndex >= 0) {
          chunks.push({
            type: "thinking-complete",
            data: { index: currentPartIndex },
          });
          currentPartIndex = -1;
        } else if (event.item && INTERNAL_TOOL_TYPES.has(event.item.type)) {
          const item = event.item as { id: string; type: string };
          const idx = internalToolIndices.get(item.id);
          if (idx !== undefined) {
            chunks.push({
              type: "internal-tool-complete",
              data: {
                index: idx,
                id: item.id,
                name: item.type,
                output: event.item,
              },
            });
            internalToolIndices.delete(item.id);
          }
        }
        break;
      }

      case "response.reasoning_text.delta": {
        if (event.delta) {
          chunks.push({
            type: "thinking-delta",
            data: {
              index: currentPartIndex,
              text: event.delta,
            },
          });
        }
        break;
      }

      case "response.reasoning_summary_text.delta": {
        if (event.delta) {
          chunks.push({
            type: "thinking-summary-delta",
            data: {
              index: currentPartIndex,
              text: event.delta,
            },
          });
        }
        break;
      }

      case "response.in_progress":
      case "response.content_part.added":
      case "response.content_part.done":
      case "response.reasoning_summary_part.added":
      case "response.reasoning_summary_part.done":
      case "response.reasoning_summary_text.done":
      case "response.reasoning_text.done":
      case "response.web_search_call.in_progress":
      case "response.web_search_call.searching":
      case "response.web_search_call.completed":
        // No-op
        break;

      default:
        console.log(`[OpenAI] unhandled stream event: ${event.type}`);
    }

    return chunks;
  }

  return { handleEvent };
}
