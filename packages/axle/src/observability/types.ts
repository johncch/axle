export type SpanStatus = "ok" | "error" | "cancelled";

export type EventLevel = "trace" | "debug" | "info" | "warn" | "error";

// Open string for span types - these are conventions, not enforced
// Common types: "workflow", "llm", "tool", "action", "internal"
export type SpanType = string;

export interface SpanEvent {
  name: string;
  timestamp: number;
  level: EventLevel;
  attributes?: Record<string, unknown>;
}

export interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  type?: SpanType;
  startTime: number;
  endTime?: number;
  status: SpanStatus;
  attributes: Record<string, unknown>;
  events: SpanEvent[];
  result?: SpanResult;
}

export interface SpanOptions {
  type?: SpanType;
  attributes?: Record<string, unknown>;
}

// Discriminated union for typed results
export type SpanResult = LLMResult | ToolResult;

export interface LLMResult {
  kind: "llm";
  model: string;
  request: LLMRequest;
  response: LLMResponse;
  usage?: TokenUsage;
  finishReason?: string;
}

export interface LLMRequest {
  messages: unknown[];
  system?: string;
  tools?: unknown[];
}

export interface LLMResponse {
  content: unknown;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  reasoningOutputTokens?: number;
}

export interface ToolResult {
  kind: "tool";
  name: string;
  input: unknown;
  output: unknown;
}

export interface TraceWriter {
  onSpanStart(span: SpanData): void;
  onSpanUpdate?(span: SpanData): void;
  onSpanEnd(span: SpanData): void;
  onEvent?(span: SpanData, event: SpanEvent): void;

  flush?(): Promise<void>;
}

/**
 * Tracing context for a span. Created by Tracer.startSpan().
 * Can create child spans and log events within the span's scope.
 */
export interface Span {
  startSpan(name: string, options?: SpanOptions): Span;
  end(status?: SpanStatus): void;

  trace(message: string, attributes?: Record<string, unknown>): void;
  debug(message: string, attributes?: Record<string, unknown>): void;
  info(message: string, attributes?: Record<string, unknown>): void;
  warn(message: string, attributes?: Record<string, unknown>): void;
  error(message: string, attributes?: Record<string, unknown>): void;

  setAttribute(key: string, value: unknown): void;
  setAttributes(attributes: Record<string, unknown>): void;

  // Typed result for the span
  setResult(result: SpanResult): void;
}
