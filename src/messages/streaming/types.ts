import { AxleStopReason } from "../../providers/types.js";
import { Stats } from "../../types.js";

export interface StreamChunk {
  type:
    | "start"
    | "text-start"
    | "text-delta"
    | "text-complete"
    | "tool-call-start"
    | "tool-call-complete"
    | "thinking-start"
    | "thinking-delta"
    | "thinking-summary-delta"
    | "thinking-complete"
    | "internal-tool-start"
    | "internal-tool-complete"
    | "complete"
    | "error";
  id?: string;
  data?: any;
}

// ---------------------------------------------------------------------------
// Stream lifecycle
// ---------------------------------------------------------------------------

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

export interface StreamErrorChunk extends StreamChunk {
  type: "error";
  data: {
    type: string;
    message: string;
    usage?: Stats;
    raw?: any;
  };
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export interface StreamTextStartChunk extends StreamChunk {
  type: "text-start";
  data: {
    index: number;
  };
}

export interface StreamTextDeltaChunk extends StreamChunk {
  type: "text-delta";
  data: {
    index: number;
    text: string;
  };
}

export interface StreamTextCompleteChunk extends StreamChunk {
  type: "text-complete";
  data: {
    index: number;
  };
}

// ---------------------------------------------------------------------------
// Thinking / Reasoning
// ---------------------------------------------------------------------------

export interface StreamThinkingStartChunk extends StreamChunk {
  type: "thinking-start";
  data: {
    index: number;
    id?: string;
    redacted?: boolean;
    signature?: string;
  };
}

export interface StreamThinkingDeltaChunk extends StreamChunk {
  type: "thinking-delta";
  data: {
    index: number;
    text: string;
  };
}

export interface StreamThinkingSummaryDeltaChunk extends StreamChunk {
  type: "thinking-summary-delta";
  data: {
    index: number;
    text: string;
  };
}

export interface StreamThinkingCompleteChunk extends StreamChunk {
  type: "thinking-complete";
  data: {
    index: number;
  };
}

// ---------------------------------------------------------------------------
// Tool calls (user-defined functions)
// ---------------------------------------------------------------------------

export interface StreamToolCallStartChunk extends StreamChunk {
  type: "tool-call-start";
  data: {
    index: number;
    id: string;
    name: string;
  };
}

export interface StreamToolCallCompleteChunk extends StreamChunk {
  type: "tool-call-complete";
  data: {
    index: number;
    id: string;
    name: string;
    arguments: any;
  };
}

// ---------------------------------------------------------------------------
// Internal tools (web search, file search, code interpreter)
// ---------------------------------------------------------------------------

export interface StreamInternalToolStartChunk extends StreamChunk {
  type: "internal-tool-start";
  data: {
    index: number;
    id: string;
    name: string;
  };
}

export interface StreamInternalToolCompleteChunk extends StreamChunk {
  type: "internal-tool-complete";
  data: {
    index: number;
    id: string;
    name: string;
    output?: unknown;
  };
}

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

export type AnyStreamChunk =
  | StreamStartChunk
  | StreamCompleteChunk
  | StreamErrorChunk
  | StreamTextStartChunk
  | StreamTextDeltaChunk
  | StreamTextCompleteChunk
  | StreamThinkingStartChunk
  | StreamThinkingDeltaChunk
  | StreamThinkingSummaryDeltaChunk
  | StreamThinkingCompleteChunk
  | StreamToolCallStartChunk
  | StreamToolCallCompleteChunk
  | StreamInternalToolStartChunk
  | StreamInternalToolCompleteChunk;
