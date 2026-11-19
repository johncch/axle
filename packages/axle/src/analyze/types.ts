import type { AxleErrorCode } from "../errors/AxleError.js";

/** Where a segment sits in the conversation. Every segment has these fields. */
export interface Segment {
  turnId: string;
  partId?: string;
  turnIndex: number;
  depth: number;
}

/** How a segment failed. */
export interface SegmentError {
  type: string;
  message: string;
  code?: AxleErrorCode;
}

/** One user or agent turn. */
export interface TurnSegment extends Segment {
  kind: "turn";
  owner: "user" | "agent";
  status: "pending" | "streaming" | "complete" | "cancelled" | "error";
  threadId?: string;
  reason?: "stop" | "length";
  cancelled?: "user" | "timeout";
  error?: SegmentError;
  recovered?: boolean;
  rescue?: boolean;
  tokens?: { in: number; out: number };
  start?: string;
  end?: string;
  ms?: number;
  parts: PartSegment[];
  tools: ToolCallSegment[];
  subagents: SubagentCallSegment[];
  compactions: CompactionSegment[];
  texts: TextSegment[];
  errors: FailedSegment[];
}

/** One call to an ordinary, deferred or provider tool. */
export interface ToolCallSegment extends Segment {
  kind: "tool" | "deferred" | "provider";
  name: string;
  callId?: string;
  status: "pending" | "running" | "waiting" | "complete" | "cancelled" | "error";
  parameters: Record<string, unknown>;
  error?: SegmentError;
  recovered?: boolean;
  start?: string;
  end?: string;
  ms?: number;
}

/** One call to a subagent, with the analysis of its own run. */
export interface SubagentCallSegment extends Segment {
  kind: "subagent";
  name: string;
  status: "pending" | "running" | "complete" | "cancelled" | "error";
  parameters: Record<string, unknown>;
  error?: SegmentError;
  recovered?: boolean;
  start?: string;
  end?: string;
  ms?: number;
  turns: TurnSegment[];
  tools: ToolCallSegment[];
  subagents: SubagentCallSegment[];
  compactions: CompactionSegment[];
  texts: TextSegment[];
  errors: FailedSegment[];
}

/** One compaction attempt. */
export interface CompactionSegment extends Segment {
  kind: "compaction";
  trigger: "manual" | "beforeTurn" | "afterTurn";
  status: "pending" | "running" | "complete" | "cancelled" | "error";
  error?: SegmentError;
  recovered?: boolean;
  start?: string;
  end?: string;
  ms?: number;
}

/** One piece of text the agent wrote. */
export interface TextSegment extends Segment {
  kind: "text";
  chars: number;
}

/** A segment that can appear in a turn's `parts`. */
export type PartSegment = ToolCallSegment | SubagentCallSegment | CompactionSegment | TextSegment;

/** A segment that can fail, and so can appear in `errors`. */
export type FailedSegment = TurnSegment | ToolCallSegment | SubagentCallSegment | CompactionSegment;

export type AnySegment = TurnSegment | PartSegment;

/**
 * What `analyze` returns: the segments of one run, grouped by kind and in
 * the order they happened. See docs/architecture/analyze.md.
 */
export interface Analysis {
  turns: TurnSegment[];
  tools: ToolCallSegment[];
  subagents: SubagentCallSegment[];
  compactions: CompactionSegment[];
  texts: TextSegment[];
  errors: FailedSegment[];
}
