import type {
  ContentBlock,
  ContentBlockParam,
  MessageStreamEvent,
  ServerToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages.js";
import type {
  AnthropicServerToolResultBlock,
  ProviderToolInput,
  ProviderToolResult,
} from "../../messages/providerTool.js";
import { AnyStreamChunk } from "../../messages/stream.js";
import { withUsageDetails } from "../../utils/stats.js";
import { truncateMiddle } from "../../utils/truncate.js";
import { convertStopReason, normalizeAnthropicCitation } from "./utils.js";

export function createAnthropicStreamingAdapter(
  openProviderToolCalls: Array<{ id: string; name: string }> = [],
) {
  const blockTypes = new Map<number, "text" | "thinking" | "tool" | "provider-tool">();
  const providerToolInfo = new Map<string, { index: number; call: ServerToolUseBlock }>();
  const earlierCallNames = new Map(openProviderToolCalls.map((call) => [call.id, call.name]));
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadInputTokens = 0;
  let cacheWriteInputTokens = 0;
  const pausedUsage = { in: 0, out: 0, cachedIn: 0, cacheWriteIn: 0 };
  let turn: "not-started" | "streaming" | "paused" = "not-started";
  const responseBlocks: Array<ContentBlock> = [];
  const pausedBlocks: Array<ContentBlock> = [];
  const serverToolInputJson = new Map<number, string>();
  let indexOffset = 0;
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
        inputTokens =
          (event.message.usage?.input_tokens ?? 0) +
          (event.message.usage?.cache_creation_input_tokens ?? 0) +
          (event.message.usage?.cache_read_input_tokens ?? 0);
        cacheWriteInputTokens = event.message.usage?.cache_creation_input_tokens ?? 0;
        cacheReadInputTokens = event.message.usage?.cache_read_input_tokens ?? 0;
        if (turn === "not-started") {
          chunks.push({
            type: "start",
            id: event.message.id,
            data: {
              model: event.message.model,
              timestamp: Date.now(),
            },
          });
        }
        turn = "streaming";
        break;

      case "message_delta":
        if (event.usage) {
          outputTokens = event.usage.output_tokens ?? outputTokens;
          if (event.usage.input_tokens != null) {
            inputTokens =
              event.usage.input_tokens +
              (event.usage.cache_creation_input_tokens ?? cacheWriteInputTokens) +
              (event.usage.cache_read_input_tokens ?? cacheReadInputTokens);
          }
          cacheWriteInputTokens = event.usage.cache_creation_input_tokens ?? cacheWriteInputTokens;
          cacheReadInputTokens = event.usage.cache_read_input_tokens ?? cacheReadInputTokens;
        }
        if (event.delta.stop_reason === "pause_turn") {
          pausedUsage.in += inputTokens;
          pausedUsage.out += outputTokens;
          pausedUsage.cachedIn += cacheReadInputTokens;
          pausedUsage.cacheWriteIn += cacheWriteInputTokens;
          inputTokens = 0;
          outputTokens = 0;
          cacheReadInputTokens = 0;
          cacheWriteInputTokens = 0;
          pausedBlocks.push(...responseBlocks);
          indexOffset += responseBlocks.length;
          responseBlocks.length = 0;
          turn = "paused";
        } else if (event.delta.stop_reason) {
          const usage = withUsageDetails(
            { in: pausedUsage.in + inputTokens, out: pausedUsage.out + outputTokens },
            {
              cachedIn: pausedUsage.cachedIn + cacheReadInputTokens,
              cacheWriteIn: pausedUsage.cacheWriteIn + cacheWriteInputTokens,
            },
          );
          if (event.delta.stop_reason === "refusal") {
            const details = event.delta.stop_details;
            chunks.push({
              type: "refusal",
              data: {
                refusal: {
                  ...(details?.explanation ? { text: details.explanation } : {}),
                  ...(details?.category ? { category: details.category } : {}),
                },
                usage,
              },
            });
          } else {
            const finishReason = convertStopReason(event.delta.stop_reason);
            chunks.push(
              finishReason === undefined
                ? {
                    type: "error",
                    data: {
                      type: "FinishReasonError",
                      message: `Unexpected stop reason: ${event.delta.stop_reason}`,
                      usage,
                      raw: event,
                    },
                  }
                : { type: "complete", data: { finishReason, usage } },
            );
          }
        }

      case "message_stop":
        // No action taken
        break;

      case "content_block_start": {
        const index = event.index + indexOffset;
        responseBlocks[event.index] = { ...event.content_block };
        if (event.content_block.type === "text") {
          blockTypes.set(index, "text");
          chunks.push({
            type: "text-start",
            data: { index },
          });
        } else if (event.content_block.type === "tool_use") {
          blockTypes.set(index, "tool");
          const toolBlock = event.content_block;
          toolCallBuffers.set(index, {
            id: toolBlock.id,
            name: toolBlock.name,
            argumentsBuffer: "",
          });

          chunks.push({
            type: "tool-call-start",
            data: {
              index,
              id: toolBlock.id,
              name: toolBlock.name,
            },
          });
        } else if (event.content_block.type === "thinking") {
          blockTypes.set(index, "thinking");
          chunks.push({
            type: "thinking-start",
            data: {
              index,
              continuity: {
                provider: "anthropic",
                signature: event.content_block.signature,
              },
            },
          });
        } else if (event.content_block.type === "redacted_thinking") {
          blockTypes.set(index, "thinking");
          chunks.push({
            type: "thinking-start",
            data: {
              index,
              redacted: true,
              continuity: {
                provider: "anthropic",
                redactedData: event.content_block.data,
              },
            },
          });
        } else if (event.content_block.type === "server_tool_use") {
          blockTypes.set(index, "provider-tool");
          const call: ServerToolUseBlock = { ...event.content_block };
          responseBlocks[event.index] = call;
          providerToolInfo.set(call.id, { index, call });
          chunks.push({
            type: "provider-tool-start",
            data: {
              index,
              id: call.id,
              name: call.name,
            },
          });
        } else if ("tool_use_id" in event.content_block) {
          const result = event.content_block;
          const info = providerToolInfo.get(result.tool_use_id);
          const earlierCallName = earlierCallNames.get(result.tool_use_id);
          if (info) {
            chunks.push({
              type: "provider-tool-complete",
              data: {
                index: info.index,
                id: result.tool_use_id,
                name: info.call.name,
                result: toProviderToolResult(info.call.name, result),
                continuity: { provider: "anthropic", call: info.call, result },
              },
            });
            providerToolInfo.delete(result.tool_use_id);
          } else if (earlierCallName !== undefined) {
            chunks.push({
              type: "provider-tool-result",
              data: {
                index,
                id: result.tool_use_id,
                name: earlierCallName,
                result: toProviderToolResult(earlierCallName, result),
                continuity: { provider: "anthropic", result },
              },
            });
            earlierCallNames.delete(result.tool_use_id);
          }
        }
        break;
      }

      case "content_block_delta": {
        const index = event.index + indexOffset;
        const responseBlock = responseBlocks[event.index];
        if (event.delta.type === "text_delta") {
          if (responseBlock?.type === "text") responseBlock.text += event.delta.text;
          chunks.push({
            type: "text-delta",
            data: {
              text: event.delta.text,
              index,
            },
          });
        } else if (event.delta.type === "input_json_delta") {
          if (responseBlock?.type === "server_tool_use") {
            serverToolInputJson.set(
              index,
              (serverToolInputJson.get(index) ?? "") + event.delta.partial_json,
            );
          }
          const buffer = toolCallBuffers.get(index);
          if (buffer) {
            buffer.argumentsBuffer += event.delta.partial_json;
            chunks.push({
              type: "tool-call-args-delta",
              data: {
                index,
                id: buffer.id,
                name: buffer.name,
                delta: event.delta.partial_json,
                accumulated: buffer.argumentsBuffer,
              },
            });
          }
        } else if (event.delta.type === "thinking_delta") {
          if (responseBlock?.type === "thinking") responseBlock.thinking += event.delta.thinking;
          chunks.push({
            type: "thinking-summary-delta",
            data: {
              text: event.delta.thinking,
              index,
            },
          });
        } else if (event.delta.type === "signature_delta") {
          if (responseBlock?.type === "thinking") responseBlock.signature = event.delta.signature;
          chunks.push({
            type: "thinking-metadata",
            data: {
              index,
              continuity: { provider: "anthropic", signature: event.delta.signature },
            },
          });
        } else if (event.delta.type === "citations_delta") {
          if (responseBlock?.type === "text") {
            responseBlock.citations = [...(responseBlock.citations ?? []), event.delta.citation];
          }
          if (blockTypes.get(index) !== "text") {
            console.warn("[Anthropic] received citation delta outside a text block", {
              index,
              blockType: blockTypes.get(index),
            });
          }
          chunks.push({
            type: "text-citation",
            data: {
              index,
              citation: normalizeAnthropicCitation(event.delta.citation),
            },
          });
        }
        break;
      }

      case "content_block_stop": {
        const index = event.index + indexOffset;
        const responseBlock = responseBlocks[event.index];
        const blockType = blockTypes.get(index);

        if (blockType === "text") {
          chunks.push({ type: "text-complete", data: { index } });
        } else if (blockType === "thinking") {
          chunks.push({ type: "thinking-complete", data: { index } });
        } else if (blockType === "provider-tool") {
          const inputJson = serverToolInputJson.get(index);
          if (responseBlock?.type === "server_tool_use") {
            if (inputJson) responseBlock.input = JSON.parse(inputJson);
            chunks.push({
              type: "provider-tool-input",
              data: {
                index,
                id: responseBlock.id,
                name: responseBlock.name,
                input: toProviderToolInput(responseBlock),
                continuity: { provider: "anthropic", call: responseBlock },
              },
            });
          }
          serverToolInputJson.delete(index);
        } else if (blockType === "tool") {
          const buffer = toolCallBuffers.get(index);
          if (buffer) {
            try {
              const parsedArgs = buffer.argumentsBuffer ? JSON.parse(buffer.argumentsBuffer) : {};
              if (responseBlock?.type === "tool_use") responseBlock.input = parsedArgs;
              chunks.push({
                type: "tool-call-complete",
                data: {
                  index,
                  id: buffer.id,
                  name: buffer.name,
                  arguments: parsedArgs,
                },
              });
            } catch (e) {
              throw new Error(
                `Failed to parse tool call arguments for ${buffer.name}: ${e instanceof Error ? e.message : String(e)}\nRaw buffer: ${truncateMiddle(buffer.argumentsBuffer)}`,
              );
            }
            toolCallBuffers.delete(index);
          }
        }

        blockTypes.delete(index);
        break;
      }
    }

    return chunks;
  }

  function pausedContent(): Array<ContentBlockParam> | undefined {
    return turn === "paused" ? [...pausedBlocks] : undefined;
  }

  return { handleEvent, pausedContent };
}

interface AnthropicServerToolInput {
  query?: string;
  url?: string;
  code?: string;
  command?: string;
}

function toProviderToolInput(call: ServerToolUseBlock): ProviderToolInput | undefined {
  if (typeof call.input !== "object" || call.input === null) return undefined;
  const input: AnthropicServerToolInput = call.input;
  if (call.name === "web_search" && input.query) return { type: "search", queries: [input.query] };
  if (call.name === "web_fetch" && input.url) return { type: "open", url: input.url };
  if (call.name === "code_execution" && input.code) return { type: "code", code: input.code };
  if (call.name === "bash_code_execution" && input.command) {
    return { type: "command", command: input.command };
  }
  return undefined;
}

function toProviderToolResult(
  name: string,
  resultBlock: AnthropicServerToolResultBlock,
): ProviderToolResult {
  const content = resultBlock.content;
  if (Array.isArray(content)) return { type: "success" };
  if ("error_code" in content) {
    return {
      type: "error",
      error: { type: content.error_code, message: `${name} failed: ${content.error_code}` },
    };
  }
  if ("stdout" in content) {
    return {
      type: "success",
      output: {
        stdout: content.stdout,
        ...(content.stderr ? { stderr: content.stderr } : {}),
        exitCode: content.return_code,
      },
    };
  }
  return { type: "success" };
}
