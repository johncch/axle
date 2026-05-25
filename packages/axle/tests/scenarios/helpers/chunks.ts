import type {
  StreamCompleteChunk,
  StreamErrorChunk,
  StreamStartChunk,
  StreamTextCompleteChunk,
  StreamTextDeltaChunk,
  StreamTextStartChunk,
  StreamThinkingCompleteChunk,
  StreamThinkingDeltaChunk,
  StreamThinkingStartChunk,
  StreamToolCallCompleteChunk,
  StreamToolCallStartChunk,
} from "../../../src/messages/stream.js";
import { AxleStopReason } from "../../../src/providers/types.js";

export function startChunk(id = "msg_1", model = "test-model"): StreamStartChunk {
  return { type: "start", id, data: { model, timestamp: Date.now() } };
}

export function textStartChunk(index: number): StreamTextStartChunk {
  return { type: "text-start", data: { index } };
}

export function textChunk(index: number, text: string): StreamTextDeltaChunk {
  return { type: "text-delta", data: { index, text } };
}

export function textCompleteChunk(index: number): StreamTextCompleteChunk {
  return { type: "text-complete", data: { index } };
}

export function thinkingStartChunk(index: number): StreamThinkingStartChunk {
  return { type: "thinking-start", data: { index } };
}

export function thinkingDeltaChunk(index: number, text: string): StreamThinkingDeltaChunk {
  return { type: "thinking-delta", data: { index, text } };
}

export function thinkingCompleteChunk(index: number): StreamThinkingCompleteChunk {
  return { type: "thinking-complete", data: { index } };
}

export function toolCallStartChunk(
  index: number,
  id: string,
  name: string,
): StreamToolCallStartChunk {
  return { type: "tool-call-start", data: { index, id, name } };
}

export function toolCallCompleteChunk(
  index: number,
  id: string,
  name: string,
  args: any,
): StreamToolCallCompleteChunk {
  return { type: "tool-call-complete", data: { index, id, name, arguments: args } };
}

export function completeChunk(
  finishReason: AxleStopReason = AxleStopReason.Stop,
  usage = { in: 10, out: 20 },
): StreamCompleteChunk {
  return { type: "complete", data: { finishReason, usage } };
}

export function errorChunk(
  type = "server_error",
  message = "Something went wrong",
): StreamErrorChunk {
  return { type: "error", data: { type, message } };
}
