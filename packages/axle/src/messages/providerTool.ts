import type { ContentBlock, ServerToolUseBlock } from "@anthropic-ai/sdk/resources/messages.js";
import type { Part } from "@google/genai";
import type {
  ResponseCodeInterpreterToolCall,
  ResponseFileSearchToolCall,
  ResponseFunctionWebSearch,
} from "openai/resources/responses/responses.js";

/** What a provider tool was asked to do, in one shape for every provider. */
export type ProviderToolInput =
  | { type: "search"; queries: string[] }
  | { type: "open"; url: string }
  | { type: "find"; url: string; pattern: string }
  | { type: "code"; code: string };

/** How a provider tool call ended. */
export type ProviderToolResult =
  { type: "success" } | { type: "error"; error: { type: string; message: string } };

/** Result block Anthropic returns for a server tool call. */
export type AnthropicServerToolResultBlock = Extract<ContentBlock, { tool_use_id: string }>;

/** Output item OpenAI returns for a hosted tool call. */
export type OpenAIProviderToolItem =
  ResponseFunctionWebSearch | ResponseFileSearchToolCall | ResponseCodeInterpreterToolCall;

/** The provider's own objects for a provider tool call, kept to send back to that provider. */
export type ProviderToolContinuity =
  | { provider: "anthropic"; call: ServerToolUseBlock; result?: AnthropicServerToolResultBlock }
  | { provider: "openai"; item: OpenAIProviderToolItem }
  | { provider: "gemini"; parts: Part[] };

/** The provider's own result for a call that an earlier assistant message holds. */
export type ProviderToolResultContinuity = {
  provider: "anthropic";
  result: AnthropicServerToolResultBlock;
};
