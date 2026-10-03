import { AxleMessage } from "../messages/message.js";
import { AnyStreamChunk } from "../messages/stream.js";
import type { Span } from "../observability/types.js";
import type { ProviderTool, ToolDefinition } from "../tools/types.js";
import { Stats } from "../types.js";
import type { FileResolver } from "../utils/file.js";
import type { ReasoningSetting } from "./reasoning.js";

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
  /**
   * Portable reasoning control: `"default"` inherits the model's behavior,
   * `"off"` sends the provider's explicit disable, `"on"` is medium effort,
   * `{ effort, display? }` picks a named level or legacy budget preset and
   * whether the provider should disclose its thinking (default `"visible"`).
   */
  reasoning?: ReasoningSetting;
  /** Maximum output tokens to request from the model. */
  maxOutputTokens?: number;
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
  createStreamingRequest(
    model: string,
    params: ProviderStreamParams,
  ): AsyncGenerator<AnyStreamChunk, void, unknown>;
}

export interface ResolvedProviderTool extends ProviderTool {
  nativeName?: string;
}

/**
 * Parameters passed to provider adapters for one streaming generation call.
 */
export interface ProviderStreamParams extends AxleModelRequestOptions {
  /** Conversation messages to send to the provider. */
  messages: Array<AxleMessage>;
  /** Optional system/developer instruction for the request. */
  system?: string;
  /** Executable tools exposed as provider function tools. */
  tools?: Array<ToolDefinition>;
  /** Provider-managed tools such as web search or code execution. */
  providerTools?: Array<ResolvedProviderTool>;
  /**
   * Identity of the conversation this request belongs to. Providers that
   * group or route by session (OpenRouter `session_id`) send it; others
   * ignore it.
   */
  sessionId?: string;
  /** Internal services available during provider request creation. */
  runtime: ProviderRuntime;
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

/**
 * What a provider reported when it declined a request or blocked its output.
 */
export interface Refusal {
  /** The refusal text or explanation the provider gave, when it gave one. */
  text?: string;
  /** The provider's own name for the reason, such as `cyber` or `SAFETY`. */
  category?: string;
}

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
  /**
   * HTTP headers sent with every request. Passed to the provider SDK's
   * default-header option as-is; on Chat Completions they are added after
   * Axle's own headers.
   */
  headers?: Record<string, string>;
}

export enum AxleStopReason {
  Stop = "stop",
  Length = "length",
  FunctionCall = "function_call",
  Cancelled = "cancelled",
}
