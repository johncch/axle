import OpenAI from "openai";
import {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseFunctionToolCall,
  ResponseReasoningItem,
} from "openai/resources/responses/responses.js";
import {
  Citation,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
} from "../../messages/message.js";
import { getTextContent } from "../../messages/utils.js";
import { raceWithSignal, throwIfAborted } from "../../utils/abort.js";
import { redactResolvedFileValues } from "../../utils/redact.js";
import { withUsageDetails } from "../../utils/stats.js";
import { AxleStopReason, ModelResult, ProviderGenerationParams } from "../types.js";
import { getUndefinedError } from "../utils.js";
import {
  convertAxleMessageToResponseInput,
  prepareProviderTools,
  prepareTools,
  toOpenAIReasoning,
  toOpenAIToolChoice,
} from "./utils.js";

export async function createGenerationRequest(
  params: ProviderGenerationParams & { client: OpenAI; model: string },
): Promise<ModelResult> {
  const {
    client,
    model,
    messages,
    system,
    tools,
    providerTools,
    runtime,
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
  const tracer = runtime?.tracer;

  let result: ModelResult;
  try {
    throwIfAborted(signal, "Generate aborted");

    if (stop !== undefined) {
      throw new Error("OpenAI Responses does not support normalized stop sequences");
    }

    const modelTools: any[] = [
      ...(prepareTools(tools) ?? []),
      ...(prepareProviderTools(providerTools) ?? []),
    ];
    const input = await convertAxleMessageToResponseInput(messages, {
      model,
      fileResolver: runtime?.fileResolver,
      signal,
    });
    const request: ResponseCreateParamsNonStreaming = {
      model,
      input,
      ...(system && { instructions: system }),

      // Axle-normalized options.
      ...(modelTools.length > 0 ? { tools: modelTools } : {}),
      ...toOpenAIReasoning(reasoning),
      ...(maxOutputTokens !== undefined ? { max_output_tokens: maxOutputTokens } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { top_p: topP } : {}),
      ...toOpenAIToolChoice(toolChoice, tools, providerTools),
      ...(parallelToolCalls !== undefined ? { parallel_tool_calls: parallelToolCalls } : {}),

      // Raw provider options are applied last so they can override Axle mappings.
      ...providerOptions,
    } as ResponseCreateParamsNonStreaming;

    tracer?.debug("OpenAI ResponsesAPI request", { request: redactResolvedFileValues(request) });

    const response = await raceWithSignal(
      client.responses.create(request, ...(signal ? [{ signal }] : [])),
      signal,
      "Generate aborted",
    );
    throwIfAborted(signal, "Generate aborted");
    result = fromModelResponse(response);
  } catch (e) {
    throwIfAborted(signal, "Generate aborted");
    tracer?.error(e instanceof Error ? e.message : String(e));
    result = getUndefinedError(e);
  }

  tracer?.debug("OpenAI ResponsesAPI response", { result });
  return result;
}

export function fromModelResponse(response: Response): ModelResult {
  if (response.error) {
    return {
      type: "error",
      error: {
        type: response.error.code || "undetermined",
        message: response.error.message || "Response generation failed",
      },
      usage: toUsage(response.usage),
      raw: response,
    };
  }

  const reasoningItems = response.output
    ?.filter((item) => item.type === "reasoning")
    ?.map((item: ResponseReasoningItem) => item);

  const content: Array<ContentPartText | ContentPartThinking | ContentPartToolCall> = [];

  if (reasoningItems && reasoningItems.length > 0) {
    for (const reasoning of reasoningItems) {
      const thinkingText = reasoning.summary?.[0]?.text || reasoning.content?.[0]?.text || "";

      if (thinkingText || reasoning.encrypted_content) {
        content.push({
          type: "thinking" as const,
          id: reasoning.id,
          ...(reasoning.content?.[0]?.text ? { text: reasoning.content[0].text } : {}),
          ...(reasoning.summary?.[0]?.text ? { summary: reasoning.summary[0].text } : {}),
          ...(reasoning.encrypted_content
            ? { continuity: { provider: "openai" as const, encrypted: reasoning.encrypted_content } }
            : {}),
        });
      }
    }
  }

  const textParts = extractTextParts(response);
  if (textParts.length > 0) {
    content.push(...textParts);
  } else if (response.output_text) {
    content.push({ type: "text" as const, text: response.output_text });
  }

  const toolCallItems = response.output?.filter((item) => item.type === "function_call");
  if (toolCallItems && toolCallItems.length > 0) {
    for (const item of toolCallItems) {
      const toolCall = item as ResponseFunctionToolCall;
      try {
        content.push({
          type: "tool-call" as const,
          id: toolCall.call_id || toolCall.id || "",
          name: toolCall.name || "",
          parameters: toolCall.arguments ? JSON.parse(toolCall.arguments) : {},
        });
      } catch (e) {
        throw new Error(
          `Failed to parse tool call arguments for ${toolCall.name}: ${e instanceof Error ? e.message : String(e)}\nRaw value: ${toolCall.arguments}`,
        );
      }
    }
  }

  return {
    type: "success",
    id: response.id,
    model: response.model || "",
    role: "assistant" as const,
    finishReason: response.incomplete_details
      ? AxleStopReason.Error
      : toolCallItems && toolCallItems.length > 0
        ? AxleStopReason.FunctionCall
        : AxleStopReason.Stop,
    content,
    text: getTextContent(content),
    usage: toUsage(response.usage),
    raw: response,
  };
}

function extractTextParts(response: Response): ContentPartText[] {
  const parts: ContentPartText[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type !== "output_text") continue;
      const citations = (content.annotations ?? [])
        .map(normalizeOpenAICitation)
        .filter((c) => c !== null);
      parts.push({
        type: "text",
        text: content.text,
        ...(citations.length > 0 ? { citations } : {}),
      });
    }
  }
  return parts;
}

function normalizeOpenAICitation(annotation: unknown): Citation | null {
  if (!annotation || typeof annotation !== "object") return null;
  const value = annotation as Record<string, any>;

  switch (value.type) {
    case "url_citation":
      return {
        source: {
          type: "web",
          title: value.title,
          url: value.url,
        },
        outputSpan: { start: value.start_index, end: value.end_index },
        providerMetadata: { type: value.type },
      };
    case "file_citation":
      return {
        source: {
          type: "document",
          title: value.filename,
          fileId: value.file_id,
        },
        providerMetadata: {
          type: value.type,
          index: value.index,
        },
      };
    case "container_file_citation":
      return {
        source: {
          type: "document",
          title: value.filename,
          fileId: value.file_id,
        },
        outputSpan: { start: value.start_index, end: value.end_index },
        providerMetadata: {
          type: value.type,
          containerId: value.container_id,
        },
      };
    case "file_path":
      return {
        source: {
          type: "document",
          fileId: value.file_id,
        },
        providerMetadata: {
          type: value.type,
          index: value.index,
        },
      };
    default:
      return {
        source: { type: "unknown" },
        providerMetadata: value,
      };
  }
}

function toUsage(usage: Response["usage"]) {
  return withUsageDetails(
    {
      in: usage?.input_tokens ?? 0,
      out: usage?.output_tokens ?? 0,
    },
    {
      cachedIn: usage?.input_tokens_details?.cached_tokens,
      reasoningOut: usage?.output_tokens_details?.reasoning_tokens,
    },
  );
}
