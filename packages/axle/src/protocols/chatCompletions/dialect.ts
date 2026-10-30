import type { AxleAssistantMessage, Citation, ThinkingContinuity } from "../../messages/message.js";
import type { ProviderTool } from "../../tools/types.js";
import type { FileInfo } from "../../utils/file.js";
import type { ReasoningSetting } from "../reasoning.js";
import type { ProviderOptions } from "../types.js";
import type { ChatCompletionAnnotation, ChatCompletionReasoningDetail } from "./types.js";

/**
 * How a provider's copy of Chat Completions differs from the protocol's
 * common request and response. Every hook is optional; an absent hook keeps
 * the protocol's own behavior.
 */
export interface ChatCompletionsDialect {
  /** Request fields for a reasoning setting, in place of `reasoning_effort`. */
  reasoning?(reasoning: ReasoningSetting | undefined): ProviderOptions;
  /** Extra request fields from the conversation's session id and cache setting. */
  requestFields?(fields: {
    sessionId: string | undefined;
    cache: boolean | undefined;
  }): ProviderOptions;
  /**
   * Request entries for the provider tools this provider serves itself. A
   * dialect without this hook serves none, and a request for one fails.
   */
  providerTools?(
    providerTools: ProviderTool[],
    warn?: (message: string, attributes?: Record<string, unknown>) => void,
  ): ProviderOptions[] | undefined;
  /** Reads and writes `reasoning_details`; without it they are ignored in responses and never sent. */
  reasoningDetails?: ChatCompletionsReasoningDetails;
  /** Reads a response annotation, in place of the standard `url_citation` reading. */
  citation?(annotation: ChatCompletionAnnotation): Citation | null;
  /** Throws for a file part the provider cannot accept. */
  assertFileSupported?(file: FileInfo): void;
}

/**
 * A provider's structured reasoning stream: how each streamed detail maps to
 * a thinking part, and what to send back so the model keeps its reasoning.
 */
export interface ChatCompletionsReasoningDetails {
  /** `reasoning_details` to send back on an assistant message. */
  toRequest(content: AxleAssistantMessage["content"]): ChatCompletionReasoningDetail[];
  /** Whether a detail's text is a summary or raw reasoning; `null` when it carries no text. */
  contentField(detail: ChatCompletionReasoningDetail): "summary" | "raw" | null;
  contentText(detail: ChatCompletionReasoningDetail): string;
  /** The thinking part's continuity after this detail, merged onto the part's previous one. */
  continuity(
    detail: ChatCompletionReasoningDetail,
    previous?: ThinkingContinuity,
  ): ThinkingContinuity;
  carriesContinuity(detail: ChatCompletionReasoningDetail): boolean;
  /** The detail without its content, recorded as `providerMetadata.reasoningDetail`. */
  identity(detail: ChatCompletionReasoningDetail): ChatCompletionReasoningDetail;
}
