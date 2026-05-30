import {
  generate,
  loadFileContent,
  stream,
  type AIProvider,
  type AxleAssistantMessage,
  type Citation,
  type ContentPartText,
  type ContentPartThinking,
  type ProviderTool,
} from "@fifthrevision/axle";
import type { MessageFormatProviderId } from "./providers.js";

export interface MessageFormatCaseContext {
  provider: AIProvider;
  model: string;
  providerId: MessageFormatProviderId;
}

export interface MessageFormatCaseResult {
  ok: boolean;
  details?: Record<string, unknown>;
}

export interface MessageFormatCase {
  id: string;
  description: string;
  providers: MessageFormatProviderId[];
  run(context: MessageFormatCaseContext): Promise<MessageFormatCaseResult>;
}

const webSearch: ProviderTool = { type: "provider", name: "web_search" };

export const messageFormatCases: MessageFormatCase[] = [
  {
    id: "openai-citations",
    description: "OpenAI web search returns normalized text citations.",
    providers: ["openai"],
    async run({ provider, model }) {
      const result = await generate({
        provider,
        model,
        providerTools: [webSearch],
        messages: [
          {
            role: "user",
            content:
              "Use web search and answer in one sentence: what is the current OpenAI homepage URL?",
          },
        ],
        maxOutputTokens: 256,
      });

      if (!result.ok) return fail({ error: result.error });
      const citations = collectCitations(result.final);
      return {
        ok: citations.some((citation) => citation.source.type === "web"),
        details: { text: collectText(result.final), citations, usage: result.usage },
      };
    },
  },
  {
    id: "openai-reasoning-summary-continuity",
    description: "OpenAI reasoning returns encrypted continuity state.",
    providers: ["openai"],
    async run({ provider, model }) {
      const result = await generate({
        provider,
        model,
        messages: [{ role: "user", content: "Answer exactly: reasoning ok" }],
        maxOutputTokens: 512,
        providerOptions: {
          store: false,
          include: ["reasoning.encrypted_content"],
          reasoning: { effort: "medium", summary: "auto" },
        },
      });

      if (!result.ok) return fail({ error: result.error });
      const thinking = collectThinking(result.final);
      return {
        ok: thinking.some((part) => part.continuity?.provider === "openai"),
        details: { thinking, text: collectText(result.final), usage: result.usage },
      };
    },
  },
  {
    id: "anthropic-thinking-text",
    description: "Anthropic extended thinking returns renderable thinking text and signature.",
    providers: ["anthropic"],
    async run({ provider, model }) {
      const result = await generate({
        provider,
        model,
        messages: [{ role: "user", content: "Answer exactly: thinking ok" }],
        maxOutputTokens: 2048,
        providerOptions: {
          thinking: { type: "enabled", budget_tokens: 1024 },
        },
      });

      if (!result.ok) return fail({ error: result.error });
      const thinking = collectThinking(result.final);
      return {
        ok: thinking.some(
          (part) => Boolean(part.text) && part.continuity?.provider === "anthropic",
        ),
        details: { thinking, text: collectText(result.final), usage: result.usage },
      };
    },
  },
  {
    id: "anthropic-redacted-thinking",
    description: "Anthropic omitted thinking returns redacted thinking continuity.",
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
            part.redacted &&
            part.continuity?.provider === "anthropic" &&
            Boolean(part.continuity.signature || part.continuity.redactedData),
        ),
        details: { thinking, text: collectText(result.final), usage: result.usage },
      };
    },
  },
  {
    id: "anthropic-citations",
    description: "Anthropic PDF inputs return normalized document citations.",
    providers: ["anthropic"],
    async run({ provider, model }) {
      const pdf = await loadFileContent("./examples/data/designing-a-new-foundation.pdf");
      const result = await generate({
        provider,
        model,
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
      return {
        ok: citations.some((citation) => citation.source.type === "document"),
        details: { text: collectText(result.final), citations, usage: result.usage },
      };
    },
  },
  {
    id: "anthropic-document-citations",
    description: "Anthropic PDF inputs return normalized document citations.",
    providers: ["anthropic"],
    async run({ provider, model }) {
      const pdf = await loadFileContent("./examples/data/designing-a-new-foundation.pdf");
      const result = await generate({
        provider,
        model,
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
      return {
        ok: citations.some((citation) => citation.source.type === "document"),
        details: { text: collectText(result.final), citations, usage: result.usage },
      };
    },
  },
  {
    id: "gemini-thinking-summary",
    description: "Gemini thinking returns thought summaries and thought signatures.",
    providers: ["gemini"],
    async run({ provider, model }) {
      const result = await generate({
        provider,
        model,
        messages: [{ role: "user", content: "Answer exactly: gemini thinking ok" }],
        maxOutputTokens: 512,
        reasoning: true,
      });

      if (!result.ok) return fail({ error: result.error });
      const thinking = collectThinking(result.final);
      return {
        ok: thinking.some(
          (part) => Boolean(part.summary) || part.continuity?.provider === "gemini",
        ),
        details: { thinking, text: collectText(result.final), usage: result.usage },
      };
    },
  },
  {
    id: "gemini-citations",
    description: "Gemini Google Search grounding returns normalized text citations.",
    providers: ["gemini"],
    async run({ provider, model }) {
      const result = await generate({
        provider,
        model,
        providerTools: [webSearch],
        messages: [
          {
            role: "user",
            content:
              "Use Google Search and answer in one sentence: what is the current Google AI Studio URL?",
          },
        ],
        maxOutputTokens: 512,
      });

      if (!result.ok) return fail({ error: result.error });
      const citations = collectCitations(result.final);
      return {
        ok: citations.some((citation) => citation.source.type === "web"),
        details: { text: collectText(result.final), citations, usage: result.usage },
      };
    },
  },
  {
    id: "citation-format",
    description: "Provider citations satisfy Axle's normalized citation format.",
    providers: ["openai", "anthropic", "gemini"],
    async run({ provider, model, providerId }) {
      if (providerId === "anthropic") {
        const pdf = await loadFileContent("./examples/data/designing-a-new-foundation.pdf");
        const result = await generate({
          provider,
          model,
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
        const validations = citations.map((citation) => validateCitationFormat(citation));
        return {
          ok: validations.some((validation) => validation.ok),
          details: {
            text: collectText(result.final),
            citations,
            validations,
            usage: result.usage,
          },
        };
      }

      const result = await generate({
        provider,
        model,
        providerTools: [webSearch],
        messages: [
          {
            role: "user",
            content:
              providerId === "openai"
                ? "Use web search and answer in one sentence: what is the current OpenAI homepage URL?"
                : "Use Google Search and answer in one sentence: what is the current Google AI Studio URL?",
          },
        ],
        maxOutputTokens: 512,
      });

      if (!result.ok) return fail({ error: result.error });
      const citations = collectCitations(result.final);
      const validations = citations.map((citation) => validateCitationFormat(citation));
      return {
        ok: validations.some((validation) => validation.ok),
        details: {
          text: collectText(result.final),
          citations,
          validations,
          usage: result.usage,
        },
      };
    },
  },
  {
    id: "citation-source-shape-fixtures",
    description: "Local fixtures cover every normalized citation source shape.",
    providers: ["openai"],
    async run() {
      const citations: Citation[] = [
        {
          source: {
            type: "web",
            title: "Example",
            url: "https://example.com",
            citedText: "Example source text.",
          },
          outputSpan: { start: 0, end: 7 },
        },
        {
          source: {
            type: "document",
            title: "Designing a New Foundation",
            fileId: "file_123",
            citedText: "Designing a new foundation.",
            locator: { type: "page", start: 1, end: 1 },
          },
        },
        {
          source: {
            type: "search-result",
            title: "Search result",
            url: "https://example.com/result",
            citedText: "Result snippet.",
            locator: { type: "block", start: 0, end: 1 },
          },
        },
        {
          source: {
            type: "retrieved-context",
            title: "Retrieved context",
            uri: "retrieval://doc/1",
            citedText: "Retrieved snippet.",
          },
        },
      ];
      const validations = citations.map((citation) => validateCitationFormat(citation));
      return { ok: validations.every((validation) => validation.ok), details: { validations } };
    },
  },
  {
    id: "chatcompletions-thinking-text",
    description: "Chat Completions-compatible reasoning fields map to thinking text.",
    providers: ["openrouter"],
    async run({ provider, model }) {
      const result = await generate({
        provider,
        model,
        messages: [{ role: "user", content: "Answer exactly: chat reasoning ok" }],
        maxOutputTokens: 512,
        reasoning: true,
      });

      if (!result.ok) return fail({ error: result.error });
      const thinking = collectThinking(result.final);
      return {
        ok: thinking.some((part) => Boolean(part.text)),
        details: { thinking, text: collectText(result.final), usage: result.usage },
      };
    },
  },
  {
    id: "stream-turn-shape",
    description: "Streaming returns a final message with normalized renderable parts.",
    providers: ["openai", "anthropic", "gemini"],
    async run({ provider, model, providerId }) {
      const handle = stream({
        provider,
        model,
        providerTools: providerId === "openai" || providerId === "gemini" ? [webSearch] : [],
        messages: [
          {
            role: "user",
            content:
              providerId === "openai" || providerId === "gemini"
                ? "Use search if available, then answer with exactly: stream shape ok"
                : "Answer exactly: stream shape ok",
          },
        ],
        maxOutputTokens: providerId === "anthropic" ? 2048 : 1024,
        reasoning: providerId === "anthropic" ? undefined : true,
        providerOptions:
          providerId === "openai"
            ? { reasoning: { effort: "medium", summary: "auto" } }
            : providerId === "anthropic"
              ? { thinking: { type: "enabled", budget_tokens: 1024 } }
              : undefined,
      });

      const events: string[] = [];
      handle.on((event) => events.push(event.type));

      const result = await handle.final;
      if (!result.ok) return fail({ error: result.error, events });
      const text = collectText(result.final);
      const thinking = collectThinking(result.final);
      const citations = collectCitations(result.final);
      const hasUsefulThinking = thinking.some(
        (part) => part.text || part.summary || part.redacted || part.continuity,
      );
      return {
        ok: Boolean(text) || hasUsefulThinking || citations.length > 0,
        details: { events, text, thinking, citations, usage: result.usage },
      };
    },
  },
];

function collectCitations(message: AxleAssistantMessage) {
  return message.content
    .filter((part): part is ContentPartText => part.type === "text")
    .flatMap((part) => part.citations ?? []);
}

function collectText(message: AxleAssistantMessage) {
  return message.content
    .filter((part): part is ContentPartText => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function collectThinking(message: AxleAssistantMessage): ContentPartThinking[] {
  return message.content.filter((part): part is ContentPartThinking => part.type === "thinking");
}

function validateCitationFormat(citation: Citation) {
  const errors: string[] = [];
  const { source } = citation;

  if (!source || !source.type || source.type === "unknown") {
    errors.push(`expected a known citation source type, got ${String(source?.type)}`);
  }

  if (source?.type === "web") {
    if (!isHttpUrl(source.url)) errors.push("expected web citation source.url to be an HTTP URL");
    if (!source.title && !source.citedText) {
      errors.push("expected web citation to expose title or citedText");
    }
  } else if (source?.type === "document") {
    if (!source.title && !source.fileId && !source.citedText) {
      errors.push("expected document citation to expose title, fileId, or citedText");
    }
    if (source.locator && !isKnownLocator(source.locator.type)) {
      errors.push(`expected known document locator type, got ${String(source.locator.type)}`);
    }
  } else if (source?.type === "search-result") {
    if (!source.title && !source.url && !source.citedText) {
      errors.push("expected search-result citation to expose title, url, or citedText");
    }
  } else if (source?.type === "retrieved-context") {
    if (!source.title && !source.uri && !source.citedText) {
      errors.push("expected retrieved-context citation to expose title, uri, or citedText");
    }
  }

  if (citation.outputSpan) {
    if (
      (citation.outputSpan.start !== undefined && !isNumber(citation.outputSpan.start)) ||
      (citation.outputSpan.end !== undefined && !isNumber(citation.outputSpan.end))
    ) {
      errors.push("expected citation.outputSpan start/end to be finite numbers when present");
    }
  }

  return { ok: errors.length === 0, errors, citation };
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//.test(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isKnownLocator(value: unknown): value is string {
  return value === "char" || value === "page" || value === "block" || value === "part";
}

function fail(details: Record<string, unknown>): MessageFormatCaseResult {
  return { ok: false, details };
}
