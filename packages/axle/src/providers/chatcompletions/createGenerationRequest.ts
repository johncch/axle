import {
  ContentPartCitation,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
} from "../../messages/message.js";
import { getTextContent } from "../../messages/utils.js";
import { raceWithSignal, throwIfAborted } from "../../utils/abort.js";
import { redactResolvedFileValues } from "../../utils/redact.js";
import { ModelResult, ProviderClientOptions, ProviderGenerationParams } from "../types.js";
import { getUndefinedError } from "../utils.js";
import { withRetry } from "./retry.js";
import { ChatCompletionResponse } from "./types.js";
import {
  chatUsageToStats,
  convertAxleMessages,
  convertFinishReason,
  convertTools,
  prepareProviderTools,
  toChatCompletionsReasoning,
  toChatCompletionsToolChoice,
  type ChatCompletionsVendor,
} from "./utils.js";
import {
  isOpenRouterTextAnchoredCitation,
  normalizeOpenRouterCitation,
} from "./vendors/openrouter/index.js";

export async function createGenerationRequest(
  params: ProviderGenerationParams &
    ProviderClientOptions & {
      baseUrl: string;
      model: string;
      apiKey?: string;
      vendor?: ChatCompletionsVendor;
    },
): Promise<ModelResult> {
  const {
    baseUrl,
    model,
    messages,
    system,
    tools,
    providerTools,
    runtime,
    apiKey,
    vendor,
    maxRetries,
    timeoutMs,
    reasoning,
    maxOutputTokens,
    temperature,
    topP,
    stop,
    toolChoice,
    parallelToolCalls,
    providerOptions,
    signal,
  } = params;
  const span = runtime?.span;

  let result: ModelResult;
  try {
    throwIfAborted(signal, "Generate aborted");

    const chatMessages = await convertAxleMessages(messages, system, {
      model,
      vendor,
      fileResolver: runtime?.fileResolver,
      signal,
      warn: span?.warn.bind(span),
    });
    const chatTools = convertTools(tools);
    const chatProviderTools = prepareProviderTools(providerTools, vendor, span?.warn.bind(span));
    const requestTools = [...(chatTools ?? []), ...(chatProviderTools ?? [])];

    const requestBody: Record<string, any> = {
      model,
      messages: chatMessages,

      // Axle-normalized options.
      ...(requestTools.length > 0 ? { tools: requestTools } : {}),
      ...toChatCompletionsReasoning(reasoning, vendor),
      ...(maxOutputTokens !== undefined ? { max_tokens: maxOutputTokens } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { top_p: topP } : {}),
      ...(stop !== undefined ? { stop } : {}),
      ...toChatCompletionsToolChoice(toolChoice, tools, providerTools),
      ...(parallelToolCalls !== undefined ? { parallel_tool_calls: parallelToolCalls } : {}),

      // Raw provider options are applied last so they can override Axle mappings.
      ...providerOptions,
    };

    span?.debug("ChatCompletions request", {
      model: requestBody.model,
      messages: requestBody.messages.length,
      tools: requestBody.tools?.length ?? 0,
    });
    span?.trace("ChatCompletions request body", {
      request: redactResolvedFileValues(requestBody),
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await withRetry(
      ({ signal }) =>
        fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
          signal,
        }),
      {
        maxRetries,
        timeoutMs,
        signal,
        onRetry: (info) =>
          span?.warn("ChatCompletions request retry", {
            attempt: info.attempt,
            maxRetries,
            timeoutMs,
            delayMs: info.delayMs,
            status: info.status,
            error: info.error instanceof Error ? info.error.message : undefined,
          }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `HTTP error! status: ${response.status}${errorText ? ` - ${errorText}` : ""}`,
      );
    }

    const data: ChatCompletionResponse = await raceWithSignal(
      response.json() as Promise<ChatCompletionResponse>,
      signal,
      "Generate aborted",
    );
    throwIfAborted(signal, "Generate aborted");
    result = fromModelResponse(data);
  } catch (e) {
    throwIfAborted(signal, "Generate aborted");
    span?.error("Error fetching ChatCompletions response", {
      error: e instanceof Error ? e.message : String(e),
    });
    result = getUndefinedError(e);
  }

  span?.trace("ChatCompletions response", { result });
  return result;
}

function fromModelResponse(data: ChatCompletionResponse): ModelResult {
  const choice = data.choices?.[0];
  if (!choice) {
    return {
      type: "error",
      error: {
        type: "ChatCompletionsError",
        message: "No choices in response",
      },
      usage: { in: 0, out: 0 },
      raw: data,
    };
  }

  const content: Array<
    ContentPartText | ContentPartThinking | ContentPartToolCall | ContentPartCitation
  > = [];

  const reasoningText = choice.message.reasoning_content ?? choice.message.reasoning;
  if (reasoningText) {
    content.push({
      type: "thinking",
      text: reasoningText,
    });
  }

  const citations = (choice.message.annotations ?? [])
    .map(normalizeOpenRouterCitation)
    .filter((citation) => citation !== null);
  const textCitations = citations.filter(isOpenRouterTextAnchoredCitation);
  const citationPartCitations = citations.filter(
    (citation) => !isOpenRouterTextAnchoredCitation(citation),
  );

  if (choice.message.content) {
    content.push({
      type: "text",
      text: choice.message.content,
      ...(textCitations.length > 0 ? { citations: textCitations } : {}),
    });
  }

  if (citationPartCitations.length > 0) {
    content.push({
      type: "citation",
      citations: citationPartCitations,
    });
  }

  if (choice.message.tool_calls) {
    for (const call of choice.message.tool_calls) {
      let parsedArgs: Record<string, unknown>;
      try {
        parsedArgs = JSON.parse(call.function.arguments);
      } catch (e) {
        throw new Error(
          `Invalid tool call arguments for ${call.function.name}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      if (typeof parsedArgs !== "object" || parsedArgs === null || Array.isArray(parsedArgs)) {
        throw new Error(
          `Invalid tool call arguments for ${call.function.name}: expected object, got ${typeof parsedArgs}`,
        );
      }

      content.push({
        type: "tool-call",
        id: call.id,
        name: call.function.name,
        parameters: parsedArgs,
      });
    }
  }

  const hasToolCalls = content.some((c) => c.type === "tool-call");
  const finishReason = hasToolCalls
    ? convertFinishReason("tool_calls")
    : convertFinishReason(choice.finish_reason);

  return {
    type: "success",
    id: data.id,
    model: data.model,
    role: "assistant",
    finishReason,
    content,
    text: getTextContent(content),
    usage: chatUsageToStats(data.usage),
    raw: data,
  };
}
