import {
  AxleMessage,
  ContentPartCitation,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
} from "../messages/message.js";
import { AnyStreamChunk } from "../messages/stream.js";
import type { Span } from "../observability/types.js";
import type { ProviderTool, ToolDefinition } from "../tools/types.js";
import { Stats } from "../types.js";
import type { FileResolver } from "../utils/file.js";

/*
 General AI Interfaces
 */

/**
 * Internal services available to provider adapters while executing a model request.
 */
export interface ProviderRuntime {
  /** Request-scoped tracing span used by provider adapters. */
  span?: Span;
  /** Resolves file references before provider-specific request conversion. */
  fileResolver?: FileResolver;
}

/**
 * Raw provider-specific request fields.
 *
 * Provider adapters apply this after Axle-normalized options, so these values
 * can intentionally override Axle's provider mappings.
 */
export interface ProviderOptions {
  [key: string]: any;
}

/**
 * Controls how the model may use tools during a single model request.
 */
export type ToolChoice = "auto" | "none" | "required" | { type: "tool"; name: string };

/**
 * Provider-portable options for a single model request.
 *
 * These fields are normalized by Axle and mapped to each provider's request
 * shape. Use `providerOptions` for provider-specific controls that are not
 * represented here.
 */
export interface AxleModelRequestOptions {
  /** Enables or disables provider reasoning/thinking controls where supported. */
  reasoning?: boolean;
  /** Maximum output tokens to request from the model. */
  maxOutputTokens?: number;
  /** Sampling temperature, when supported by the provider/model. */
  temperature?: number;
  /** Nucleus sampling value, mapped to provider-specific casing. */
  topP?: number;
  /** Stop sequence or sequences for text generation. */
  stop?: string | string[];
  /** Constrains tool use for this model request. */
  toolChoice?: ToolChoice;
  /** Requests that the provider avoid parallel tool calls when supported. */
  parallelToolCalls?: boolean;
  /** Raw provider-specific request fields applied after normalized mappings. */
  providerOptions?: ProviderOptions;
  /** Abort signal for the in-flight model request. */
  signal?: AbortSignal;
}

export interface AIProvider {
  get name(): string;

  /**
   * Resolves a portable provider-tool name to the provider-native name.
   * Returning undefined marks the tool unsupported. When omitted, Axle
   * preserves the provider's existing passthrough behavior.
   *
   * @internal
   */
  resolveProviderToolName?(name: string, model: string): string | undefined;

  /** @internal */
  createGenerationRequest(model: string, params: ProviderGenerationParams): Promise<ModelResult>;

  /** @internal */
  createStreamingRequest(
    model: string,
    params: ProviderStreamParams,
  ): AsyncGenerator<AnyStreamChunk, void, unknown>;
}

export interface ResolvedProviderTool extends ProviderTool {
  nativeName?: string;
}

/**
 * Parameters passed to provider adapters for one non-streaming generation call.
 */
export interface ProviderGenerationParams extends AxleModelRequestOptions {
  /** Conversation messages to send to the provider. */
  messages: Array<AxleMessage>;
  /** Optional system/developer instruction for the request. */
  system?: string;
  /** Executable tools exposed as provider function tools. */
  tools?: Array<ToolDefinition>;
  /** Provider-managed tools such as web search or code execution. */
  providerTools?: Array<ResolvedProviderTool>;
  /** Internal services available during provider request creation. */
  runtime: ProviderRuntime;
}

/**
 * Parameters passed to provider adapters for one streaming generation call.
 */
export interface ProviderStreamParams extends ProviderGenerationParams {}

export interface ModelResponse {
  type: "success";
  role: "assistant";
  id: string;
  model: string;
  text: string;
  content: Array<ContentPartText | ContentPartThinking | ContentPartToolCall | ContentPartCitation>;
  finishReason: AxleStopReason;
  usage: Stats;
  raw: any;
}

export interface ModelError {
  type: "error";
  error: {
    type: string;
    message: string;
  };
  usage?: Stats;
  raw?: any;
}

export type ModelResult = ModelResponse | ModelError;

export interface ContextUsage {
  total: number;
  system: number;
  tools: number;
  mcpTools: number;
  providerTools: number;
  messages: number;
  limit?: number;
  free?: number;
}

/**
 * Client-level transport options for provider adapters.
 *
 * These options are applied when the provider client is constructed, not per
 * model request.
 */
export interface ProviderClientOptions {
  /**
   * Number of retry attempts after the first request. Axle's built-in
   * providers default to `2`; use `0` to disable retries.
   */
  maxRetries?: number;
  /**
   * Request timeout in milliseconds. Omit to use the provider SDK default.
   */
  timeoutMs?: number;
}

export enum AxleStopReason {
  Stop = "stop",
  Length = "length",
  FunctionCall = "function_call",
  Error = "error",
  Custom = "custom",
  Cancelled = "cancelled",
}
