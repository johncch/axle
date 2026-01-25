export type SpanStatus = "ok" | "error";

export type EventLevel = "debug" | "info" | "warn" | "error";

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
}

// Discriminated union for typed results
export type SpanResult = LLMResult | ToolResult | ActionResult;

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
}

export interface ToolResult {
  kind: "tool";
  name: string;
  input: unknown;
  output: unknown;
}

export interface ActionResult {
  kind: "action";
  name: string;
  input: unknown;
  output: unknown;
}

export interface TraceWriter {
  onSpanStart(span: SpanData): void;
  onSpanUpdate?(span: SpanData): void;
  onSpanEnd(span: SpanData): void;
  onEvent?(span: SpanData, event: SpanEvent): void;

  // LLM streaming support
  onLLMStreamStart?(span: SpanData): void;
  onLLMStreamChunk?(span: SpanData, chunk: string): void;
  onLLMStreamEnd?(span: SpanData, result: LLMResult): void;

  flush?(): Promise<void>;
}

/**
 * Tracing context for a span. Created by Tracer.startSpan().
 * Can create child spans and log events within the span's scope.
 */
export interface TracingContext {
  startSpan(name: string, options?: SpanOptions): TracingContext;
  end(status?: SpanStatus): void;

  debug(message: string, attributes?: Record<string, unknown>): void;
  info(message: string, attributes?: Record<string, unknown>): void;
  warn(message: string, attributes?: Record<string, unknown>): void;
  error(message: string, attributes?: Record<string, unknown>): void;

  setAttribute(key: string, value: unknown): void;
  setAttributes(attributes: Record<string, unknown>): void;

  // Typed result for the span
  setResult(result: SpanResult): void;

  // LLM streaming helpers - span buffers content internally
  startLLMStream(): void;
  appendLLMStream(chunk: string): void;
  endLLMStream(result: LLMResult): void;
}
