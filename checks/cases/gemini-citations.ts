import { generate, stream, type AIProvider } from "@fifthrevision/axle";
import { FinishReason, type GenerateContentResponse } from "@google/genai";
import { createGeminiStreamingAdapter } from "../../packages/axle/src/providers/gemini/createStreamingAdapter.js";
import type { CheckCase } from "./types.js";

export const geminiCitationCases: CheckCase[] = [
  {
    id: "format-gemini-delayed-citations",
    group: "extended",
    providers: ["gemini"],
    description:
      "Gemini grounding survives a trailing thought signature through generate and stream.",
    async run() {
      const provider: AIProvider = {
        name: "Gemini",
        async *createStreamingRequest() {
          const adapter = createGeminiStreamingAdapter();
          for (const candidate of [
            { content: { parts: [{ text: "The answer" }] } },
            { content: { parts: [{ thoughtSignature: "fixture-signature" }] } },
            {
              groundingMetadata: {
                groundingChunks: [{ web: { title: "Source", uri: "https://example.com" } }],
                groundingSupports: [
                  {
                    groundingChunkIndices: [0],
                    segment: { endIndex: 10, text: "The answer" },
                  },
                ],
              },
              finishReason: FinishReason.STOP,
            },
          ]) {
            yield* adapter.handleChunk({
              responseId: "citation-fixture",
              candidates: [candidate],
            } as GenerateContentResponse);
          }
        },
      };
      for (const api of [
        generate,
        (options: Parameters<typeof generate>[0]) => stream(options).final,
      ]) {
        const result = await api({ provider, model: "fixture", messages: [] });
        if (!result.ok) return { ok: false, details: { error: result.error } };
        const text = result.final.content.find((part) => part.type === "text");
        const citation = text?.citations?.[0];
        if (
          text?.text !== "The answer" ||
          citation?.source.type !== "web" ||
          citation.source.url !== "https://example.com" ||
          citation.outputSpan?.start !== 0 ||
          citation.outputSpan.end !== 10
        ) {
          return { ok: false, details: { content: result.final.content } };
        }
      }
      return { ok: true };
    },
  },
];
