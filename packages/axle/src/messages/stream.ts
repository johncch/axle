import { AxleStopReason, type Refusal } from "../providers/types.js";
import { Stats } from "../types.js";
import type { Citation, ThinkingContinuity } from "./message.js";
import type {
  ProviderToolContinuity,
  ProviderToolInput,
  ProviderToolResult,
  ProviderToolResultContinuity,
} from "./providerTool.js";

export interface StreamChunk {
  type:
    | "start"
    | "text-start"
    | "text-delta"
    | "text-citation"
    | "citation"
    | "text-complete"
    | "tool-call-start"
    | "tool-call-args-delta"
    | "tool-call-complete"
    | "thinking-start"
    | "thinking-raw-delta"
    | "thinking-summary-delta"
    | "thinking-metadata"
    | "thinking-complete"
    | "provider-tool-start"
    | "provider-tool-input"
    | "provider-tool-complete"
    | "provider-tool-result"
    | "complete"
    | "refusal"
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
    status?: number;
    usage?: Stats;
    raw?: unknown;
  };
}

export interface StreamRefusalChunk extends StreamChunk {
  type: "refusal";
  data: {
    refusal: Refusal;
    usage: Stats;
  };
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export interface StreamTextStartChunk extends StreamChunk {
  type: "text-start";
  data: {
    index: number;
    providerMetadata?: Record<string, unknown>;
  };
}

export interface StreamTextDeltaChunk extends StreamChunk {
  type: "text-delta";
  data: {
    index: number;
    text: string;
  };
}

export interface StreamTextCitationChunk extends StreamChunk {
  type: "text-citation";
  data: {
    index: number;
    citation: Citation;
  };
}

export interface StreamCitationChunk extends StreamChunk {
  type: "citation";
  data: {
    index: number;
    citations: Citation[];
    providerMetadata?: Record<string, unknown>;
  };
}

export interface StreamTextCompleteChunk extends StreamChunk {
  type: "text-complete";
  data: {
    index: number;
    providerMetadata?: Record<string, unknown>;
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
    continuity?: ThinkingContinuity;
    providerMetadata?: Record<string, unknown>;
  };
}

export interface StreamThinkingRawDeltaChunk extends StreamChunk {
  type: "thinking-raw-delta";
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

export interface StreamThinkingMetadataChunk extends StreamChunk {
  type: "thinking-metadata";
  data: {
    index: number;
    continuity?: ThinkingContinuity;
    redacted?: boolean;
    providerMetadata?: Record<string, unknown>;
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

export interface StreamToolCallArgsDeltaChunk extends StreamChunk {
  type: "tool-call-args-delta";
  data: {
    index: number;
    id: string;
    name: string;
    delta: string;
    accumulated: string;
  };
}

export interface StreamToolCallCompleteChunk extends StreamChunk {
  type: "tool-call-complete";
  data: {
    index: number;
    id: string;
    name: string;
    arguments: any;
    error?: {
      type: string;
      message: string;
      raw?: string;
    };
    providerMetadata?: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Provider tools (web search, file search, code interpreter)
// ---------------------------------------------------------------------------

export interface StreamProviderToolStartChunk extends StreamChunk {
  type: "provider-tool-start";
  data: {
    index: number;
    id: string;
    name: string;
  };
}

export interface StreamProviderToolInputChunk extends StreamChunk {
  type: "provider-tool-input";
  data: {
    index: number;
    id: string;
    name: string;
    input?: ProviderToolInput;
    continuity?: ProviderToolContinuity;
  };
}

export interface StreamProviderToolCompleteChunk extends StreamChunk {
  type: "provider-tool-complete";
  data: {
    index: number;
    id: string;
    name: string;
    result: ProviderToolResult;
    continuity?: ProviderToolContinuity;
  };
}

export interface StreamProviderToolResultChunk extends StreamChunk {
  type: "provider-tool-result";
  data: {
    index: number;
    id: string;
    name: string;
    result: ProviderToolResult;
    continuity: ProviderToolResultContinuity;
  };
}

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

export type AnyStreamChunk =
  | StreamStartChunk
  | StreamCompleteChunk
  | StreamRefusalChunk
  | StreamErrorChunk
  | StreamTextStartChunk
  | StreamTextDeltaChunk
  | StreamTextCitationChunk
  | StreamCitationChunk
  | StreamTextCompleteChunk
  | StreamThinkingStartChunk
  | StreamThinkingRawDeltaChunk
  | StreamThinkingSummaryDeltaChunk
  | StreamThinkingMetadataChunk
  | StreamThinkingCompleteChunk
  | StreamToolCallStartChunk
  | StreamToolCallArgsDeltaChunk
  | StreamToolCallCompleteChunk
  | StreamProviderToolStartChunk
  | StreamProviderToolInputChunk
  | StreamProviderToolCompleteChunk
  | StreamProviderToolResultChunk;
