import { GenerateContentResponse, GoogleGenAI } from "@google/genai";
import {
  Citation,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
} from "../../messages/message.js";
import { getTextContent } from "../../messages/utils.js";
import type { TracingContext } from "../../tracer/types.js";
import { raceWithSignal, throwIfAborted } from "../../utils/abort.js";
import { redactResolvedFileValues } from "../../utils/redact.js";
import { withUsageDetails } from "../../utils/stats.js";
import { AxleStopReason, ModelResult, ProviderGenerationParams } from "../types.js";
import { getUndefinedError } from "../utils.js";
import {
  addGeminiProviderTools,
  convertAxleMessagesToGemini,
  convertStopReason,
  prepareConfig,
  toGeminiThinkingConfig,
  toGeminiToolConfig,
} from "./utils.js";

export async function createGenerationRequest(
  params: ProviderGenerationParams & { client: GoogleGenAI; model: string },
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

  const googleOptions: Record<string, any> = {
    // Axle-normalized options.
    ...toGeminiThinkingConfig(reasoning),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { topP } : {}),
    ...(stop !== undefined ? { stopSequences: Array.isArray(stop) ? stop : [stop] } : {}),
    ...toGeminiToolConfig(toolChoice, parallelToolCalls, tools, providerTools),

    // Raw provider options are applied last so they can override Axle mappings.
    ...providerOptions,
  };

  let result: ModelResult;
  try {
    throwIfAborted(signal, "Generate aborted");

    const contents = await convertAxleMessagesToGemini(messages, {
      model,
      fileResolver: runtime?.fileResolver,
      signal,
    });

    const config = prepareConfig(tools, system, googleOptions);
    if (toolChoice !== "none") {
      addGeminiProviderTools(config, providerTools);
    }

    const request = {
      contents,
      config,
    };
    tracer?.debug("Gemini request", { request: redactResolvedFileValues(request) });

    const response = await raceWithSignal(
      client.models.generateContent({
        model,
        ...request,
      }),
      signal,
      "Generate aborted",
    );
    throwIfAborted(signal, "Generate aborted");
    result = fromModelResponse(response, { tracer });
  } catch (e) {
    throwIfAborted(signal, "Generate aborted");
    tracer?.error(e instanceof Error ? e.message : String(e));
    result = getUndefinedError(e);
  }

  tracer?.debug("Gemini response", { result });
  return result;
}

export function fromModelResponse(
  response: GenerateContentResponse,
  context: { tracer?: TracingContext },
): ModelResult {
  const { tracer } = context;

  const inTokens = response.usageMetadata?.promptTokenCount ?? 0;
  const totalTokens = response.usageMetadata?.totalTokenCount ?? inTokens;
  const outTokens = totalTokens - inTokens;
  const usage = withUsageDetails(
    { in: inTokens, out: outTokens },
    {
      cachedIn: (response.usageMetadata as any)?.cachedContentTokenCount,
      reasoningOut: (response.usageMetadata as any)?.thoughtsTokenCount,
    },
  );

  if (!response) {
    return {
      type: "error",
      error: {
        type: "InvalidResponse",
        message: "Invalid or empty response from Google AI",
      },
      usage: { in: 0, out: 0 },
      raw: response,
    };
  }

  if (response.promptFeedback && response.promptFeedback.blockReason) {
    return {
      type: "error",
      error: {
        type: "Blocked",
        message: `Response blocked by Google AI: ${response.promptFeedback.blockReason}, ${response.promptFeedback.blockReasonMessage}`,
      },
      usage,
      raw: response,
    };
  }

  if (!response.candidates || response.candidates.length === 0) {
    return {
      type: "error",
      error: {
        type: "InvalidResponse",
        message: "Invalid or empty response from Google AI",
      },
      usage: { in: 0, out: 0 },
      raw: response,
    };
  }

  if (response.candidates.length > 1) {
    tracer?.warn(`We received ${response.candidates.length} response candidates`);
  }

  const candidate = response.candidates[0];
  const parts = candidate.content?.parts || [];

  const [success, reason] = convertStopReason(candidate.finishReason);
  if (success) {
    const content: Array<ContentPartText | ContentPartThinking | ContentPartToolCall> = [];

    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      if (!part.text) continue;
      if (part.thought) {
        content.push({
          type: "thinking" as const,
          summary: part.text,
          ...(part.thoughtSignature
            ? { continuity: { provider: "gemini" as const, thoughtSignature: part.thoughtSignature } }
            : {}),
        });
      } else {
        const citations = normalizeGeminiCitations(candidate, index);
        pushTextPart(content, {
          type: "text" as const,
          text: part.text,
          ...(citations.length > 0 ? { citations } : {}),
          ...(part.thoughtSignature
            ? { providerMetadata: { thoughtSignature: part.thoughtSignature } }
            : {}),
        });
      }
    }

    const functionCallParts = parts.filter((part) => part.functionCall);
    const functionCalls =
      functionCallParts.length > 0
        ? functionCallParts.map((part) => ({
            call: part.functionCall!,
            thoughtSignature: (part as Record<string, unknown>).thoughtSignature,
          }))
        : (response.functionCalls ?? []).map((call) => ({ call, thoughtSignature: undefined }));

    if (functionCalls.length > 0) {
      for (const { call, thoughtSignature } of functionCalls) {
        if (call.args == null) {
          content.push({
            type: "tool-call" as const,
            id: call.id ?? "",
            name: call.name ?? "",
            parameters: {},
            ...(thoughtSignature ? { providerMetadata: { thoughtSignature } } : {}),
          });
        } else if (typeof call.args !== "object" || Array.isArray(call.args)) {
          throw new Error(
            `Invalid tool call arguments for ${call.name}: expected object, got ${typeof call.args}`,
          );
        } else {
          content.push({
            type: "tool-call" as const,
            id: call.id ?? "",
            name: call.name ?? "",
            parameters: call.args as Record<string, unknown>,
            ...(thoughtSignature ? { providerMetadata: { thoughtSignature } } : {}),
          });
        }
      }
    }

    return {
      type: "success",
      id: response.responseId ?? "",
      model: response.modelVersion ?? "",
      role: "assistant",
      finishReason: functionCalls.length > 0 ? AxleStopReason.FunctionCall : reason,
      content,
      text: getTextContent(content),
      usage,
      raw: response,
    };
  } else {
    return {
      type: "error",
      error: {
        type: "Undetermined",
        message: `Unexpected stop reason: ${reason}`,
      },
      usage,
      raw: response,
    };
  }
}

function pushTextPart(
  content: Array<ContentPartText | ContentPartThinking | ContentPartToolCall>,
  part: ContentPartText,
) {
  const previous = content[content.length - 1];
  const canMerge =
    previous?.type === "text" &&
    !previous.citations?.length &&
    !previous.providerMetadata &&
    !part.citations?.length &&
    !part.providerMetadata;

  if (canMerge) {
    previous.text += part.text;
    return;
  }

  content.push(part);
}

function normalizeGeminiCitations(candidate: NonNullable<GenerateContentResponse["candidates"]>[number], partIndex: number): Citation[] {
  const citations: Citation[] = [];
  const groundingMetadata = candidate.groundingMetadata;
  const chunks = groundingMetadata?.groundingChunks ?? [];

  for (const support of groundingMetadata?.groundingSupports ?? []) {
    if (support.segment?.partIndex !== undefined && support.segment.partIndex !== partIndex) {
      continue;
    }
    for (const chunkIndex of support.groundingChunkIndices ?? []) {
      const chunk = chunks[chunkIndex];
      if (!chunk) continue;
      citations.push(normalizeGeminiGroundingChunk(chunk, support));
    }
  }

  for (const citation of candidate.citationMetadata?.citations ?? []) {
    citations.push({
      source: citation.uri
        ? { type: "web", title: citation.title, url: citation.uri }
        : { type: "unknown" },
      outputSpan: { start: citation.startIndex, end: citation.endIndex },
      providerMetadata: {
        license: citation.license,
        publicationDate: citation.publicationDate,
      },
    });
  }

  return citations;
}

function normalizeGeminiGroundingChunk(chunk: any, support: any): Citation {
  const segment = support.segment;
  if (chunk.web) {
    return {
      source: {
        type: "web",
        title: chunk.web.title,
        url: chunk.web.uri,
      },
      outputSpan: { start: segment?.startIndex, end: segment?.endIndex },
      providerMetadata: {
        outputText: segment?.text,
        confidenceScores: support.confidenceScores,
      },
    };
  }
  if (chunk.retrievedContext) {
    return {
      source: {
        type: "retrieved-context",
        title: chunk.retrievedContext.title,
        uri: chunk.retrievedContext.uri,
        citedText: chunk.retrievedContext.text,
        locator: {
          type: "page",
          start: chunk.retrievedContext.pageNumber,
          end: chunk.retrievedContext.pageNumber,
        },
      },
      outputSpan: { start: segment?.startIndex, end: segment?.endIndex },
      providerMetadata: {
        documentName: chunk.retrievedContext.documentName,
        outputText: segment?.text,
        confidenceScores: support.confidenceScores,
      },
    };
  }
  if (chunk.maps) {
    return {
      source: {
        type: "web",
        title: chunk.maps.title,
        url: chunk.maps.uri,
        citedText: chunk.maps.text,
      },
      outputSpan: { start: segment?.startIndex, end: segment?.endIndex },
      providerMetadata: {
        placeId: chunk.maps.placeId,
        outputText: segment?.text,
        confidenceScores: support.confidenceScores,
      },
    };
  }
  return {
    source: { type: "unknown" },
    outputSpan: { start: segment?.startIndex, end: segment?.endIndex },
    providerMetadata: { chunk, outputText: segment?.text, confidenceScores: support.confidenceScores },
  };
}
