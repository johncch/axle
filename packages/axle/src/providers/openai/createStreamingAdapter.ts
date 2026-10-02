import { ResponseOutputItem, ResponseStreamEvent } from "openai/resources/responses/responses.js";
import type { Citation } from "../../messages/message.js";
import type { OpenAIProviderToolItem, ProviderToolInput } from "../../messages/providerTool.js";
import { AnyStreamChunk } from "../../messages/stream.js";
import { withUsageDetails } from "../../utils/stats.js";
import { AxleStopReason } from "../types.js";

function isProviderToolItem(item: ResponseOutputItem): item is OpenAIProviderToolItem {
  return (
    item.type === "web_search_call" ||
    item.type === "file_search_call" ||
    item.type === "code_interpreter_call"
  );
}

function toProviderToolName(item: OpenAIProviderToolItem): string {
  switch (item.type) {
    case "web_search_call":
      return "web_search";
    case "code_interpreter_call":
      return "code_execution";
    case "file_search_call":
      return "file_search";
  }
}

function toProviderToolInput(item: OpenAIProviderToolItem): ProviderToolInput | undefined {
  switch (item.type) {
    case "web_search_call": {
      const action = item.action;
      if (!action) return undefined;
      switch (action.type) {
        case "search": {
          const queries = action.queries ?? (action.query ? [action.query] : []);
          return queries.length > 0 ? { type: "search", queries } : undefined;
        }
        case "open_page":
          return action.url ? { type: "open", url: action.url } : undefined;
        case "find_in_page":
          return { type: "find", url: action.url, pattern: action.pattern };
      }
    }
    case "code_interpreter_call":
      return item.code ? { type: "code", code: item.code } : undefined;
    case "file_search_call":
      return item.queries.length > 0 ? { type: "search", queries: item.queries } : undefined;
  }
}

export function createStreamingAdapter() {
  let messageId = "";
  let model = "";
  let partIndex = 0;
  let currentPartIndex = -1;
  let hasFunctionCalls = false;
  const textPartIndices = new Map<string, number>();
  const messagePhases = new Map<string, string>();
  const functionInfo = new Map<string, { name: string; callId: string }>();
  const providerToolIndices = new Map<string, number>();
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
        const key = textKey(event.item_id, event.content_index);
        if (currentPartIndex === -1) {
          currentPartIndex = partIndex++;
          textPartIndices.set(key, currentPartIndex);
          const phase = messagePhases.get(event.item_id);
          chunks.push({
            type: "text-start",
            data: {
              index: currentPartIndex,
              ...(phase ? { providerMetadata: { provider: "openai", phase } } : {}),
            },
          });
        }
        chunks.push({
          type: "text-delta",
          data: { text: event.delta, index: currentPartIndex },
        });
        break;
      }

      case "response.output_text.done": {
        const key = textKey(event.item_id, event.content_index);
        textPartIndices.set(key, currentPartIndex);
        if (currentPartIndex >= 0) {
          chunks.push({
            type: "text-complete",
            data: { index: currentPartIndex },
          });
          currentPartIndex = -1;
        }
        break;
      }

      case "response.output_text.annotation.added": {
        const citation = normalizeOpenAICitation(event.annotation);
        if (!citation) break;
        const index = textPartIndices.get(textKey(event.item_id, event.content_index));
        if (index === undefined) {
          console.warn(
            "[OpenAI] received text annotation without a resolved text part; falling back to current part",
            {
              itemId: event.item_id,
              contentIndex: event.content_index,
            },
          );
        }
        chunks.push({
          type: "text-citation",
          data: {
            index: index ?? currentPartIndex,
            citation,
          },
        });
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
        chunks.push({
          type: "tool-call-args-delta",
          data: {
            index: buffer.partIdx,
            id: buffer.callId,
            name: buffer.name,
            delta: event.delta,
            accumulated: buffer.argumentsBuffer,
          },
        });
        break;
      }

      case "response.function_call_arguments.done": {
        hasFunctionCalls = true;
        const itemId = event.item_id;
        const buffer = toolCallBuffers.get(itemId);
        const name = (event as any).name || buffer?.name || "";

        if (buffer) {
          try {
            const parsedArgs = event.arguments ? JSON.parse(event.arguments) : {};
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
            usage: withUsageDetails(
              {
                in: usage?.input_tokens || 0,
                out: usage?.output_tokens || 0,
              },
              {
                cachedIn: usage?.input_tokens_details?.cached_tokens,
                cacheWriteIn: usage?.input_tokens_details?.cache_write_tokens,
                reasoningOut: usage?.output_tokens_details?.reasoning_tokens,
              },
            ),
          },
        });
        break;
      }

      case "response.failed": {
        chunks.push({
          type: "error",
          data: {
            type: event.response.error?.code || "RESPONSES_API_ERROR",
            message: event.response.error?.message || `Response failed: ${event.response.status}`,
            usage: withUsageDetails(
              {
                in: event.response.usage?.input_tokens || 0,
                out: event.response.usage?.output_tokens || 0,
              },
              {
                cachedIn: event.response.usage?.input_tokens_details?.cached_tokens,
                cacheWriteIn: event.response.usage?.input_tokens_details?.cache_write_tokens,
                reasoningOut: event.response.usage?.output_tokens_details?.reasoning_tokens,
              },
            ),
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
            data: { index: currentPartIndex, id: event.item.id },
          });
        } else if (event.item?.type === "message") {
          if (event.item.phase) messagePhases.set(event.item.id, event.item.phase);
        } else if (event.item?.type === "function_call") {
          const item = event.item as { id?: string; name: string; call_id: string };
          const itemId = item.id || item.call_id;
          if (itemId) {
            functionInfo.set(itemId, {
              name: item.name || "",
              callId: item.call_id || itemId,
            });
          }
        } else if (event.item && isProviderToolItem(event.item)) {
          const item = event.item;
          const idx = partIndex++;
          providerToolIndices.set(item.id, idx);
          chunks.push({
            type: "provider-tool-start",
            data: {
              index: idx,
              id: item.id,
              name: toProviderToolName(item),
            },
          });
        }
        break;
      }

      case "response.output_item.done": {
        if (event.item?.type === "reasoning" && currentPartIndex >= 0) {
          if (event.item.encrypted_content) {
            chunks.push({
              type: "thinking-metadata",
              data: {
                index: currentPartIndex,
                continuity: { provider: "openai", encrypted: event.item.encrypted_content },
              },
            });
          }
          chunks.push({
            type: "thinking-complete",
            data: { index: currentPartIndex },
          });
          currentPartIndex = -1;
        } else if (event.item && isProviderToolItem(event.item)) {
          const item = event.item;
          const idx = providerToolIndices.get(item.id);
          if (idx !== undefined) {
            const name = toProviderToolName(item);
            const input = toProviderToolInput(item);
            if (input) {
              chunks.push({
                type: "provider-tool-input",
                data: {
                  index: idx,
                  id: item.id,
                  name,
                  input,
                  continuity: { provider: "openai", item },
                },
              });
            }
            chunks.push({
              type: "provider-tool-complete",
              data: {
                index: idx,
                id: item.id,
                name,
                result:
                  item.status === "failed"
                    ? { type: "error", error: { type: "failed", message: `${name} failed` } }
                    : { type: "success" },
                continuity: { provider: "openai", item },
              },
            });
            providerToolIndices.delete(item.id);
          }
        }
        break;
      }

      case "response.reasoning_text.delta": {
        if (event.delta) {
          chunks.push({
            type: "thinking-raw-delta",
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

function textKey(itemId: string, contentIndex: number): string {
  return `${itemId}:${contentIndex}`;
}

function normalizeOpenAICitation(annotation: unknown): Citation | null {
  if (!annotation || typeof annotation !== "object") return null;
  const value = annotation as Record<string, any>;

  switch (value.type) {
    case "url_citation":
      return {
        source: {
          type: "web",
          title: value.title,
          url: value.url,
        },
        outputSpan: { start: value.start_index, end: value.end_index },
        providerMetadata: { type: value.type },
      };
    case "file_citation":
      return {
        source: {
          type: "document",
          title: value.filename,
          fileId: value.file_id,
        },
        providerMetadata: { type: value.type, index: value.index },
      };
    case "container_file_citation":
      return {
        source: {
          type: "document",
          title: value.filename,
          fileId: value.file_id,
        },
        outputSpan: { start: value.start_index, end: value.end_index },
        providerMetadata: {
          type: value.type,
          containerId: value.container_id,
        },
      };
    case "file_path":
      return {
        source: {
          type: "document",
          fileId: value.file_id,
        },
        providerMetadata: { type: value.type, index: value.index },
      };
    default:
      return { source: { type: "unknown" }, providerMetadata: value };
  }
}
