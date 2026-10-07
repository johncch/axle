import {
  generate,
  loadFileContent,
  stream,
  type AIProvider,
  type AxleAssistantMessage,
  type AxleMessage,
  type AxleModelRequestOptions,
  type Citation,
  type ContentPartThinking,
  type ExecutableTool,
  type ProviderTool,
} from "@fifthrevision/axle";
import * as z from "zod";
import { fail, getAssistantText, reasoningPrompt } from "./helpers.js";
import type { CheckCase, CheckCaseResult } from "./types.js";

const webSearchTool: ProviderTool = { type: "provider", name: "web_search" };

export const messageFormatCases: CheckCase[] = [
  {
    group: "extended",
    id: "format-web-citations",
    description: "Hosted web search returns citations in Axle's normalized format.",
    providers: ["openai", "google", "openrouter"],
    async run({ provider, model, providerId, requestOptions }) {
      const result = await generate({
        provider,
        model,
        ...requestOptions,
        providerTools: [webSearchTool],
        messages: [
          {
            role: "user",
            content:
              providerId === "google"
                ? "Use Google Search and answer in one sentence: what is the current Google AI Studio URL?"
                : "Use web search and answer in one sentence: what is the current OpenAI homepage URL?",
          },
        ],
        maxOutputTokens: 512,
      });

      if (!result.ok) return fail({ error: result.error });
      const citations = collectCitations(result.final);
      const failureReasons = [
        ...(citations.some((citation) => citation.source.type === "web")
          ? []
          : ["No web citation was returned."]),
        ...citations.flatMap(validateCitationFormat),
      ];
      return {
        ok: failureReasons.length === 0,
        ...(failureReasons.length > 0 ? { failureReasons } : {}),
        details: { text: getAssistantText(result.final), citations, usage: result.usage },
      };
    },
  },
  {
    group: "extended",
    id: "format-document-citations",
    description: "PDF inputs return document citations in Axle's normalized format.",
    providers: ["anthropic"],
    async run({ provider, model, requestOptions }) {
      const pdf = await loadFileContent("./packages/axle/examples/data/designing-a-new-foundation.pdf");
      const result = await generate({
        provider,
        model,
        ...requestOptions,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Answer in one sentence with a citation: what does the attached PDF say about designing a new foundation?",
              },
              { type: "file", file: pdf },
            ],
          },
        ],
        maxOutputTokens: 2048,
      });

      if (!result.ok) return fail({ error: result.error });
      const citations = collectCitations(result.final);
      const failureReasons = [
        ...(citations.some((citation) => citation.source.type === "document")
          ? []
          : ["No document citation was returned."]),
        ...citations.flatMap(validateCitationFormat),
      ];
      return {
        ok: failureReasons.length === 0,
        ...(failureReasons.length > 0 ? { failureReasons } : {}),
        details: { text: getAssistantText(result.final), citations, usage: result.usage },
      };
    },
  },
  {
    group: "default",
    id: "format-web-citations-follow-up",
    description: "A follow-up request is accepted after an answer with web search citations.",
    providers: ["anthropic", "openai", "google", "openrouter"],
    async run({ provider, model, providerId, requestOptions }) {
      return runCitationFollowUp({
        provider,
        model,
        requestOptions:
          providerId === "openai"
            ? { reasoning: { effort: "medium" }, ...requestOptions }
            : requestOptions,
        providerTools: [webSearchTool],
        sourceType: "web",
        messages: [
          {
            role: "user",
            content:
              providerId === "openai"
                ? "Use web search and answer in one sentence: what is the current OpenAI homepage URL and its headline?"
                : providerId === "google"
                  ? "Use Google Search and answer in one sentence, citing your source: what kind of company is Anthropic?"
                  : "Use web search and answer in one sentence, citing your source: what kind of company is Anthropic?",
          },
        ],
      });
    },
  },
  {
    group: "extended",
    id: "format-document-citations-follow-up",
    description: "A follow-up request is accepted after an answer with document citations.",
    providers: ["anthropic"],
    async run({ provider, model, requestOptions }) {
      const pdf = await loadFileContent("./packages/axle/examples/data/designing-a-new-foundation.pdf");
      return runCitationFollowUp({
        provider,
        model,
        requestOptions,
        sourceType: "document",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Answer in one sentence with a citation: what does the attached PDF say about designing a new foundation?",
              },
              { type: "file", file: pdf },
            ],
          },
        ],
      });
    },
  },
  {
    group: "default",
    id: "format-server-tool-with-client-tool",
    description:
      "A web search called alongside a local tool keeps its result from the next step, and a follow-up request is accepted.",
    providers: ["anthropic"],
    async run({ provider, model, requestOptions }) {
      const schema = z.object({});
      const getBuildNumber: ExecutableTool<typeof schema> = {
        name: "get_build_number",
        description: "Return the current build number of this machine.",
        schema,
        async execute() {
          return "build 4127";
        },
      };
      const messages: AxleMessage[] = [
        {
          role: "user",
          content:
            "Do both of these at the same time, as parallel tool calls in one response: " +
            "(1) web search for 'Anthropic homepage', (2) call get_build_number. " +
            "Do not wait for one before starting the other. Then report both results in one sentence.",
        },
      ];

      const completedProviderToolIds: string[] = [];
      const handle = stream({
        provider,
        model,
        ...requestOptions,
        providerTools: [webSearchTool],
        tools: [getBuildNumber],
        messages,
        maxOutputTokens: 2048,
      });
      handle.on((event) => {
        if (event.type === "provider-tool:complete") completedProviderToolIds.push(event.id);
      });
      const first = await handle.final;
      if (!first.ok) return fail({ error: first.error });

      const assistantParts = first.messages.flatMap((message) =>
        message.role === "assistant" ? message.content : [],
      );
      const deferredCall = assistantParts.find(
        (part) => part.type === "provider-tool" && !part.result,
      );
      if (!deferredCall || deferredCall.type !== "provider-tool") {
        return {
          ok: false,
          failureReasons: [
            "The model did not call web search alongside the local tool, so nothing was exercised.",
          ],
          details: { parts: assistantParts.map((part) => part.type) },
        };
      }

      const failureReasons = [
        ...(assistantParts.some(
          (part) => part.type === "provider-tool-result" && part.id === deferredCall.id,
        )
          ? []
          : ["The search result that arrived in the next step was not stored."]),
        ...(completedProviderToolIds.includes(deferredCall.id)
          ? []
          : ["provider-tool:complete did not fire for the search."]),
      ];
      if (failureReasons.length > 0) {
        return { ok: false, failureReasons, details: { text: getAssistantText(first.final) } };
      }

      const followUp = await generate({
        provider,
        model,
        ...requestOptions,
        providerTools: [webSearchTool],
        tools: [getBuildNumber],
        messages: [
          ...messages,
          ...first.messages,
          { role: "user", content: "What was the build number again? Answer with the number." },
        ],
        maxOutputTokens: 2048,
      });
      if (!followUp.ok) return fail({ error: followUp.error });

      return {
        ok: true,
        details: {
          text: getAssistantText(first.final),
          followUpText: getAssistantText(followUp.final),
          usage: followUp.usage,
        },
      };
    },
  },
  {
    group: "extended",
    id: "format-thinking-continuity",
    description:
      "Thinking parts carry renderable content, plus the provider continuity payload where one exists.",
    providers: ["openai", "anthropic", "google", "openrouter"],
    async run({ provider, model, providerId }) {
      const result = await generate({
        provider,
        model,
        messages: [{ role: "user", content: reasoningPrompt }],
        ...(providerId === "openai"
          ? {
              maxOutputTokens: 512,
              providerOptions: {
                store: false,
                include: ["reasoning.encrypted_content"],
                reasoning: { effort: "medium", summary: "auto" },
              },
            }
          : { reasoning: { effort: "high" } }),
      });

      if (!result.ok) return fail({ error: result.error });
      const thinking = collectThinking(result.final);
      // Gemini only issues thought signatures alongside function calls, so a
      // plain text turn legitimately has no continuity there.
      const failureReasons = [
        ...(thinking.length > 0 ? [] : ["No thinking part was returned."]),
        ...(providerId !== "google" &&
        !thinking.some((part) => part.continuity?.provider === providerId)
          ? [`No thinking part carries ${providerId} continuity.`]
          : []),
        ...(providerId === "anthropic" && !thinking.some((part) => Boolean(part.summary))
          ? ["Anthropic thinking part has no summary."]
          : []),
        ...(providerId === "google" &&
        !thinking.some((part) => Boolean(part.summary) || Boolean(part.text))
          ? ["Gemini thinking part has neither summary nor text."]
          : []),
      ];
      return {
        ok: failureReasons.length === 0,
        ...(failureReasons.length > 0 ? { failureReasons } : {}),
        details: { thinking, text: getAssistantText(result.final), usage: result.usage },
      };
    },
  },
  {
    group: "extended",
    id: "format-thinking-hidden",
    description:
      "Hidden Anthropic thinking surfaces as a part with continuity only: no content, and not marked redacted.",
    providers: ["anthropic"],
    async run({ provider, model }) {
      const result = await generate({
        provider,
        model,
        messages: [{ role: "user", content: reasoningPrompt }],
        reasoning: { effort: "high", display: "hidden" },
      });

      if (!result.ok) return fail({ error: result.error });
      const thinking = collectThinking(result.final);
      const failureReasons = [
        ...(thinking.some(
          (part) => part.continuity?.provider === "anthropic" && part.continuity.signature,
        )
          ? []
          : ["No thinking part carries an Anthropic signature."]),
        ...(thinking.some((part) => part.summary || part.text)
          ? ["A hidden thinking part carried content."]
          : []),
        ...(thinking.some((part) => part.redacted)
          ? ["A hidden thinking part was marked redacted."]
          : []),
      ];
      return {
        ok: failureReasons.length === 0,
        ...(failureReasons.length > 0 ? { failureReasons } : {}),
        details: { thinking, text: getAssistantText(result.final), usage: result.usage },
      };
    },
  },
  {
    group: "extended",
    id: "format-thinking-stream",
    description:
      "Streamed reasoning ends in a normalized thinking part; providers that stream thinking text emit raw or summary delta events.",
    providers: ["openai", "anthropic", "google", "openrouter", "together"],
    async run({ provider, model, providerId }) {
      const handle = stream({
        provider,
        model,
        messages: [{ role: "user", content: reasoningPrompt }],
        reasoning: { effort: "high" },
        ...(providerId === "openai"
          ? { providerOptions: { reasoning: { effort: "medium", summary: "auto" } } }
          : {}),
      });
      const events: string[] = [];
      let thinkingDeltaCount = 0;
      handle.on((event) => {
        events.push(event.type);
        if (event.type === "thinking:raw-delta" || event.type === "thinking:summary-delta") {
          thinkingDeltaCount += 1;
        }
      });

      const result = await handle.final;
      if (!result.ok) return fail({ error: result.error, events });
      const thinking = collectThinking(result.final);
      // OpenAI and Gemini stream summaries only when the model chooses to
      // write one, so deltas are required only where thinking text is streamed.
      const streamsThinkingText =
        providerId === "anthropic" || providerId === "openrouter" || providerId === "together";
      const failureReasons = [
        ...(thinking.some((part) => part.text || part.summary || part.redacted || part.continuity)
          ? []
          : ["Final message has no thinking part with content or continuity."]),
        ...(streamsThinkingText && thinkingDeltaCount === 0
          ? ["No thinking delta events were emitted."]
          : []),
      ];
      return {
        ok: failureReasons.length === 0,
        ...(failureReasons.length > 0 ? { failureReasons } : {}),
        details: {
          thinkingDeltaCount,
          events,
          thinking,
          text: getAssistantText(result.final),
          usage: result.usage,
        },
      };
    },
  },
];

async function runCitationFollowUp({
  provider,
  model,
  requestOptions,
  providerTools,
  sourceType,
  messages,
}: {
  provider: AIProvider;
  model: string;
  requestOptions: AxleModelRequestOptions;
  providerTools?: ProviderTool[];
  sourceType: Citation["source"]["type"];
  messages: AxleMessage[];
}): Promise<CheckCaseResult> {
  const first = await generate({
    provider,
    model,
    ...requestOptions,
    providerTools,
    messages,
    maxOutputTokens: 2048,
  });
  if (!first.ok) return fail({ error: first.error });

  const citations = collectCitations(first.final);
  if (!citations.some((citation) => citation.source.type === sourceType)) {
    return {
      ok: false,
      failureReasons: [`No ${sourceType} citation was returned, so nothing was replayed.`],
      details: { text: getAssistantText(first.final), citations },
    };
  }

  const followUp = await generate({
    provider,
    model,
    ...requestOptions,
    providerTools,
    messages: [
      ...messages,
      ...first.messages,
      { role: "user", content: "Repeat the source you cited, in five words or fewer." },
    ],
    maxOutputTokens: 2048,
  });
  if (!followUp.ok) return fail({ error: followUp.error, citations });

  return {
    ok: true,
    details: {
      text: getAssistantText(first.final),
      followUpText: getAssistantText(followUp.final),
      citations,
      usage: followUp.usage,
    },
  };
}

function collectCitations(message: AxleAssistantMessage): Citation[] {
  return message.content.flatMap((part) => {
    if (part.type === "text") return part.citations ?? [];
    if (part.type === "citation") return part.citations;
    return [];
  });
}

function collectThinking(message: AxleAssistantMessage): ContentPartThinking[] {
  return message.content.filter((part): part is ContentPartThinking => part.type === "thinking");
}

function validateCitationFormat(citation: Citation): string[] {
  const errors: string[] = [];
  const { source } = citation;

  if (source.type === "web") {
    if (!isHttpUrl(source.url)) errors.push("web citation source.url is not an HTTP URL");
    if (!source.title && !source.citedText) errors.push("web citation has no title or citedText");
  } else if (source.type === "document") {
    if (!source.title && !source.fileId && !source.citedText) {
      errors.push("document citation has no title, fileId, or citedText");
    }
    if (source.locator && !isKnownLocator(source.locator.type)) {
      errors.push(`document citation has unknown locator type ${String(source.locator.type)}`);
    }
  } else if (source.type === "search-result") {
    if (!source.title && !source.url && !source.citedText) {
      errors.push("search-result citation has no title, url, or citedText");
    }
  } else if (source.type === "retrieved-context") {
    if (!source.title && !source.uri && !source.citedText) {
      errors.push("retrieved-context citation has no title, uri, or citedText");
    }
  } else {
    errors.push(
      `citation source type ${String((source as { type: unknown }).type)} is not normalized`,
    );
  }

  const span = citation.outputSpan;
  if (
    span &&
    ((span.start !== undefined && !isFiniteNumber(span.start)) ||
      (span.end !== undefined && !isFiniteNumber(span.end)))
  ) {
    errors.push("citation outputSpan start/end are not finite numbers");
  }

  return errors;
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//.test(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isKnownLocator(value: unknown): boolean {
  return value === "char" || value === "page" || value === "block" || value === "part";
}
