import {
  generate,
  loadFileContent,
  stream,
  type AxleAssistantMessage,
  type Citation,
  type ContentPartThinking,
  type ProviderTool,
} from "@fifthrevision/axle";
import { fail, getAssistantText } from "./helpers.js";
import type { BaselineCase } from "./types.js";

const webSearchTool: ProviderTool = { type: "provider", name: "web_search" };

// Trivial prompts often produce no visible reasoning; a small puzzle makes
// every provider emit thinking content.
const reasoningPrompt =
  "How many times does the letter r appear in the phrase 'strawberry raspberry'? Work it out, then answer with only the number.";

export const messageFormatCases: BaselineCase[] = [
  {
    group: "extended",
    id: "format-web-citations",
    description: "Hosted web search returns citations in Axle's normalized format.",
    providers: ["openai", "gemini"],
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
              providerId === "gemini"
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
      const pdf = await loadFileContent("./examples/data/designing-a-new-foundation.pdf");
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
    group: "extended",
    id: "format-thinking-continuity",
    description:
      "Thinking parts carry renderable content, plus the provider continuity payload where one exists.",
    providers: ["openai", "anthropic", "gemini"],
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
          : { reasoning: true }),
      });

      if (!result.ok) return fail({ error: result.error });
      const thinking = collectThinking(result.final);
      // Gemini only issues thought signatures alongside function calls, so a
      // plain text turn legitimately has no continuity there.
      const failureReasons = [
        ...(thinking.length > 0 ? [] : ["No thinking part was returned."]),
        ...(providerId !== "gemini" &&
        !thinking.some((part) => part.continuity?.provider === providerId)
          ? [`No thinking part carries ${providerId} continuity.`]
          : []),
        ...(providerId === "anthropic" && !thinking.some((part) => Boolean(part.text))
          ? ["Anthropic thinking part has no renderable text."]
          : []),
        ...(providerId === "gemini" &&
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
    id: "format-thinking-redacted",
    description: "Omitted Anthropic thinking surfaces as a redacted part with continuity.",
    providers: ["anthropic"],
    async run({ provider, model }) {
      const result = await generate({
        provider,
        model,
        messages: [{ role: "user", content: "Answer exactly: redacted ok" }],
        maxOutputTokens: 2048,
        providerOptions: {
          thinking: { type: "enabled", budget_tokens: 1024, display: "omitted" },
        },
      });

      if (!result.ok) return fail({ error: result.error });
      const thinking = collectThinking(result.final);
      return {
        ok: thinking.some(
          (part) =>
            part.redacted === true &&
            part.continuity?.provider === "anthropic" &&
            Boolean(part.continuity.signature || part.continuity.redactedData),
        ),
        details: { thinking, text: getAssistantText(result.final), usage: result.usage },
      };
    },
  },
  {
    group: "extended",
    id: "format-thinking-stream",
    description:
      "Streamed reasoning ends in a normalized thinking part; providers that stream thinking text emit thinking:delta events.",
    providers: ["openai", "anthropic", "gemini", "openrouter"],
    async run({ provider, model, providerId }) {
      const handle = stream({
        provider,
        model,
        messages: [{ role: "user", content: reasoningPrompt }],
        reasoning: true,
        ...(providerId === "openai"
          ? { providerOptions: { reasoning: { effort: "medium", summary: "auto" } } }
          : {}),
      });
      const events: string[] = [];
      let thinkingDeltaCount = 0;
      handle.on((event) => {
        events.push(event.type);
        if (event.type === "thinking:delta") thinkingDeltaCount += 1;
      });

      const result = await handle.final;
      if (!result.ok) return fail({ error: result.error, events });
      const thinking = collectThinking(result.final);
      // OpenAI and Gemini stream summaries only when the model chooses to
      // write one, so deltas are required only where thinking text is streamed.
      const streamsThinkingText = providerId === "anthropic" || providerId === "openrouter";
      const failureReasons = [
        ...(thinking.some((part) => part.text || part.summary || part.redacted || part.continuity)
          ? []
          : ["Final message has no thinking part with content or continuity."]),
        ...(streamsThinkingText && thinkingDeltaCount === 0
          ? ["No thinking:delta events were emitted."]
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
