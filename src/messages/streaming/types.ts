import { AxleStopReason } from "../../providers/types.js";
import { Stats } from "../../types.js";

export interface StreamChunk {
  type:
    | "start"
    | "text"
    | "tool-call-start"
    | "tool-call-delta"
    | "tool-call-complete"
    | "thinking-start"
    | "thinking-delta"
    | "complete"
    | "error";
  id?: string;
  data?: any;
}

export interface StreamStartChunk extends StreamChunk {
  type: "start";
  id: string;
  data: {
    model: string;
    timestamp: number;
  };
}

export interface StreamCompleteChunk extends StreamChunk {
  type: "complete";
  data: {
    finishReason: AxleStopReason;
    usage: Stats;
  };
}

export interface StreamTextChunk extends StreamChunk {
  type: "text";
  data: {
    text: string;
    index: number;
  };
}

export interface StreamThinkingStartChunk extends StreamChunk {
  type: "thinking-start";
  data: {
    index: number;
    redacted?: boolean;
  };
}

export interface StreamThinkingDeltaChunk extends StreamChunk {
  type: "thinking-delta";
  data: {
    index: number;
    text: string;
  };
}

export interface StreamToolCallStartChunk extends StreamChunk {
  type: "tool-call-start";
  data: {
    index: number;
    id: string;
    name: string;
  };
}

// export interface StreamToolCallDeltaChunk extends StreamChunk {
//   type: "tool-call-delta";
//   data: {
//     index: number;
//     id: string;
//     argumentsDelta: string;
//   };
// }

export interface StreamToolCallCompleteChunk extends StreamChunk {
  type: "tool-call-complete";
  data: {
    index: number;
    id: string;
    name: string;
    arguments: any;
  };
}

export interface StreamErrorChunk extends StreamChunk {
  type: "error";
  data: {
    type: string;
    message: string;
    usage?: Stats;
    raw?: any;
  };
}

export type AnyStreamChunk =
  | StreamStartChunk
  | StreamCompleteChunk
  | StreamTextChunk
  | StreamToolCallStartChunk
  // | StreamToolCallDeltaChunk
  | StreamToolCallCompleteChunk
  | StreamThinkingStartChunk
  | StreamThinkingDeltaChunk
  | StreamErrorChunk;
