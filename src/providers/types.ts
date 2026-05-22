import {
  AxleMessage,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
} from "../messages/message.js";
import { AnyStreamChunk } from "../messages/stream.js";
import { ProviderTool, ToolDefinition } from "../tools/types.js";
import type { TracingContext } from "../tracer/types.js";
import { Stats } from "../types.js";
import type { FileResolver } from "../utils/file.js";

/*
 Vendor specific configuration
 */
export type AnthropicProviderConfig = { "api-key": string; model?: string };
export type OpenAIProviderConfig = { "api-key": string; model?: string };
export type GeminiProviderConfig = { "api-key": string; model?: string };
export type ChatCompletionsProviderConfig = {
  "base-url": string;
  model: string;
  "api-key"?: string;
};

export interface AIProviderConfig {
  chatcompletions: ChatCompletionsProviderConfig;
  anthropic: AnthropicProviderConfig;
  openai: OpenAIProviderConfig;
  gemini: GeminiProviderConfig;
}

/*
 General AI Interfaces
 */

/**
 * Internal services available to provider adapters while executing a model request.
 */
export interface ProviderRuntime {
  /** Request-scoped tracing span used by provider adapters. */
  tracer?: TracingContext;
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
  providerTools?: Array<ProviderTool>;
  /** Internal services available during provider request creation. */
  runtime: ProviderRuntime;
}

/**
 * Parameters passed to provider adapters for one streaming generation call.
 */
export interface ProviderStreamParams extends ProviderGenerationParams {}

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

export interface AIProvider {
  get name(): string;

  /** @internal */
  createGenerationRequest(model: string, params: ProviderGenerationParams): Promise<ModelResult>;

  /** @internal */
  createStreamingRequest(
    model: string,
    params: ProviderStreamParams,
  ): AsyncGenerator<AnyStreamChunk, void, unknown>;
}

export interface ModelResponse {
  type: "success";
  role: "assistant";
  id: string;
  model: string;
  text: string;
  content: Array<ContentPartText | ContentPartThinking | ContentPartToolCall>;
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

export enum AxleStopReason {
  Stop = "stop",
  Length = "length",
  FunctionCall = "function_call",
  Error = "error",
  Custom = "custom",
  Cancelled = "cancelled",
}
