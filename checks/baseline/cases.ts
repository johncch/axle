import {
  Agent,
  Instruct,
  generate,
  loadFileContent,
  stream,
  type AIProvider,
  type AxleAssistantMessage,
  type AxleModelRequestOptions,
  type ExecutableTool,
  type ProviderTool,
} from "@fifthrevision/axle";
import * as z from "zod";
import type { BaselineProviderId } from "./providers.js";

export interface BaselineCaseContext {
  provider: AIProvider;
  model: string;
  providerId: string;
  requestOptions: AxleModelRequestOptions;
}

export interface BaselineCaseResult {
  ok: boolean;
  details?: Record<string, unknown>;
}

export interface BaselineCase {
  id: string;
  description: string;
  providers?: BaselineProviderId[];
  run(context: BaselineCaseContext): Promise<BaselineCaseResult>;
}

const answerSchema = z.object({
  answer: z.string(),
  count: z.number(),
  ok: z.boolean(),
});

const webSearchTool: ProviderTool = { type: "provider", name: "web_search" };

export const baselineCases: BaselineCase[] = [
  {
    id: "generate-basic",
    description: "Basic generate() text response.",
    async run({ provider, model, requestOptions }) {
      const result = await generate({
        provider,
        model,
        ...requestOptions,
        messages: [{ role: "user", content: "Reply with exactly: pong" }],
      });

      if (!result.ok) return fail({ error: result.error });
      const text = getAssistantText(result.final);
      return {
        ok: text.toLowerCase().includes("pong"),
        details: { text, usage: result.usage },
      };
    },
  },
  {
    id: "stream-basic",
    description: "Basic stream() text response.",
    async run({ provider, model, requestOptions }) {
      const textDeltas: string[] = [];
      const handle = stream({
        provider,
        model,
        ...requestOptions,
        messages: [{ role: "user", content: "Reply with exactly: pong" }],
      });
      handle.on((event) => {
        if (event.type === "text:delta") textDeltas.push(event.delta);
      });

      const result = await handle.final;
      if (!result.ok) return fail({ error: result.error });
      const text = getAssistantText(result.final);
      return {
        ok: text.toLowerCase().includes("pong") && textDeltas.length > 0,
        details: { text, textDeltaCount: textDeltas.length, usage: result.usage },
      };
    },
  },
  {
    id: "generate-instruct-json",
    description: "generate() with Instruct structured JSON response.",
    async run({ provider, model, requestOptions }) {
      const result = await generate({
        provider,
        model,
        ...requestOptions,
        instruct: new Instruct({
          prompt: "Return answer='pong', count=3, ok=true.",
          schema: answerSchema,
        }),
      });

      if (!result.ok) return fail({ error: result.error });
      return {
        ok: Boolean(
          result.response?.answer.toLowerCase().includes("pong") &&
          result.response.count === 3 &&
          result.response.ok === true,
        ),
        details: { response: result.response },
      };
    },
  },
  {
    id: "stream-instruct-json",
    description: "stream() with Instruct structured JSON response.",
    async run({ provider, model, requestOptions }) {
      const handle = stream({
        provider,
        model,
        ...requestOptions,
        instruct: new Instruct({
          prompt: "Return answer='pong', count=3, ok=true.",
          schema: answerSchema,
        }),
      });
      const result = await handle.final;

      if (!result.ok) return fail({ error: result.error });
      return {
        ok: Boolean(
          result.response?.answer.toLowerCase().includes("pong") &&
          result.response.count === 3 &&
          result.response.ok === true,
        ),
        details: { response: result.response },
      };
    },
  },
  {
    id: "generate-instruct-history",
    description: "generate() uses historical messages plus latest Instruct turn.",
    async run({ provider, model, requestOptions }) {
      const result = await generate({
        provider,
        model,
        ...requestOptions,
        messages: [
          {
            role: "user",
            content: "Remember this code word for the next message: lavender.",
          },
          {
            role: "assistant",
            id: "history-assistant",
            content: [{ type: "text", text: "I will remember lavender." }],
          },
        ],
        instruct: new Instruct({
          prompt: "What is the code word?",
          schema: z.object({ word: z.string() }),
        }),
      });

      if (!result.ok) return fail({ error: result.error });
      return {
        ok: result.response?.word.toLowerCase().includes("lavender") ?? false,
        details: { response: result.response },
      };
    },
  },
  {
    id: "agent-basic",
    description: "Agent basic send() text response and history.",
    async run({ provider, model, requestOptions }) {
      const agent = new Agent({ provider, model, ...requestOptions });
      const result = await agent.send("Reply with exactly: pong").final;
      const text = String(result.response ?? "");

      return {
        ok: text.toLowerCase().includes("pong") && agent.history.turns.length === 2,
        details: {
          response: result.response,
          turnCount: agent.history.turns.length,
          usage: result.usage,
        },
      };
    },
  },
  {
    id: "agent-instruct-json",
    description: "Agent send(Instruct) structured JSON response.",
    async run({ provider, model, requestOptions }) {
      const agent = new Agent({ provider, model, ...requestOptions });
      const result = await agent.send(
        new Instruct({
          prompt: "Return answer='pong', count=3, ok=true.",
          schema: answerSchema,
        }),
      ).final;

      return {
        ok: Boolean(
          result.response?.answer.toLowerCase().includes("pong") &&
          result.response.count === 3 &&
          result.response.ok === true &&
          agent.history.turns.length === 2,
        ),
        details: {
          response: result.response,
          turnCount: agent.history.turns.length,
          usage: result.usage,
        },
      };
    },
  },
  {
    id: "agent-multiturn-history",
    description: "Agent preserves history across turns.",
    async run({ provider, model, requestOptions }) {
      const agent = new Agent({ provider, model, ...requestOptions });
      await agent.send("For this conversation, the code word is lavender. Reply exactly: stored.")
        .final;
      const result = await agent.send(
        "Using the previous message in this conversation, what is the code word?",
      ).final;
      const text = String(result.response ?? "");

      return {
        ok: text.toLowerCase().includes("lavender") && agent.history.turns.length === 4,
        details: {
          response: result.response,
          turnCount: agent.history.turns.length,
          usage: result.usage,
        },
      };
    },
  },
  {
    id: "generate-tool",
    description: "generate() executes a local tool and reaches a final answer.",
    async run({ provider, model, requestOptions }) {
      const result = await generate({
        provider,
        model,
        ...requestOptions,
        messages: [
          {
            role: "user",
            content: "Use the add_numbers tool to add 17 and 25. Then answer with the result.",
          },
        ],
        tools: [addNumbersTool],
      });

      if (!result.ok) return fail({ error: result.error });
      const text = getAssistantText(result.final);
      return {
        ok: text.includes("42") && hasSuccessfulToolResult(result.messages),
        details: {
          text,
          toolResults: getToolResultDetails(result.messages),
          messageCount: result.messages.length,
          usage: result.usage,
        },
      };
    },
  },
  {
    id: "stream-tool",
    description: "stream() executes a local tool and reaches a final answer.",
    async run({ provider, model, requestOptions }) {
      let toolRequestCount = 0;
      const handle = stream({
        provider,
        model,
        ...requestOptions,
        messages: [
          {
            role: "user",
            content: "Use the add_numbers tool to add 17 and 25. Then answer with the result.",
          },
        ],
        tools: [addNumbersTool],
      });
      handle.on((event) => {
        if (event.type === "tool:request") toolRequestCount += 1;
      });

      const result = await handle.final;
      if (!result.ok) return fail({ error: result.error });
      const text = getAssistantText(result.final);
      return {
        ok: text.includes("42") && toolRequestCount > 0 && hasSuccessfulToolResult(result.messages),
        details: {
          text,
          toolRequestCount,
          toolResults: getToolResultDetails(result.messages),
          messageCount: result.messages.length,
          usage: result.usage,
        },
      };
    },
  },
  {
    id: "agent-tool",
    description: "Agent executes a local tool and reaches a final answer.",
    async run({ provider, model, requestOptions }) {
      const agent = new Agent({ provider, model, ...requestOptions, tools: [addNumbersTool] });
      const result = await agent.send(
        "Use the add_numbers tool to add 17 and 25. Then answer with the result.",
      ).final;
      const text = String(result.response ?? "");

      return {
        ok: text.includes("42") && hasSuccessfulToolResult(agent.history.log),
        details: {
          response: result.response,
          toolResults: getToolResultDetails(agent.history.log),
          turnCount: agent.history.turns.length,
          usage: result.usage,
        },
      };
    },
  },
  {
    id: "reasoning-false",
    description: "generate() succeeds with reasoning disabled.",
    async run({ provider, model }) {
      const result = await generate({
        provider,
        model,
        messages: [{ role: "user", content: "Reply with exactly: pong" }],
        reasoning: false,
      });

      if (!result.ok) return fail({ error: result.error });
      const text = getAssistantText(result.final);
      return {
        ok: text.toLowerCase().includes("pong"),
        details: { text, usage: result.usage },
      };
    },
  },
  {
    id: "stream-web-search",
    description: "stream() with provider web search surfaces provider-specific search evidence.",
    async run({ provider, model, providerId, requestOptions }) {
      return runStreamingWebSearchCitationCase({
        provider,
        model,
        providerId,
        requestOptions,
        prompt:
          "Use web search to find the current top headline on Reuters.com. Answer with only the headline.",
      });
    },
  },
  {
    id: "instruct-text-reference",
    description: "Instruct text references are included in the user turn.",
    async run({ provider, model, requestOptions }) {
      const instruct = new Instruct({
        prompt: "Return the project code from the reference.",
        schema: z.object({
          code: z.string(),
        }),
      });
      instruct.addFile("Project code: orchid-17", { name: "project-note" });

      const result = await generate({ provider, model, ...requestOptions, instruct });
      if (!result.ok) return fail({ error: result.error });
      return {
        ok: result.response?.code.toLowerCase().includes("orchid-17") ?? false,
        details: { response: result.response },
      };
    },
  },
  {
    id: "generate-image-file",
    description: "generate() with an Instruct image file attachment.",
    async run({ provider, model, requestOptions }) {
      const image = await loadFileContent("./examples/data/economist-brainy-imports.png");
      const instruct = new Instruct({
        prompt: "Inspect the attached chart. Return the chart title and the top listed university.",
        schema: z.object({
          title: z.string(),
          topUniversity: z.string(),
        }),
      });
      instruct.addFile(image);

      const result = await generate({ provider, model, ...requestOptions, instruct });
      if (!result.ok) return fail({ error: result.error });

      const title = result.response.title.toLowerCase();
      const topUniversity = result.response.topUniversity.toLowerCase();
      return {
        ok:
          (title.includes("brainy") || title.includes("import")) &&
          topUniversity.includes("carnegie"),
        details: { response: result.response },
      };
    },
  },
  {
    id: "generate-pdf-file",
    description: "generate() with an Instruct PDF file attachment.",
    async run({ provider, model, requestOptions }) {
      const pdf = await loadFileContent("./examples/data/designing-a-new-foundation.pdf");
      const instruct = new Instruct({
        prompt:
          "Inspect the attached document. Return fileType exactly as 'pdf' and provide a short summary.",
        schema: z.object({
          fileType: z.literal("pdf"),
          summary: z.string(),
        }),
      });
      instruct.addFile(pdf);

      const result = await generate({ provider, model, ...requestOptions, instruct });
      if (!result.ok) return fail({ error: result.error });

      return {
        ok: result.response.fileType === "pdf" && result.response.summary.trim().length > 0,
        details: { response: result.response },
      };
    },
  },
];

async function runStreamingWebSearchCitationCase({
  provider,
  model,
  providerId,
  requestOptions,
  prompt,
}: {
  provider: AIProvider;
  model: string;
  providerId: string;
  requestOptions: AxleModelRequestOptions;
  prompt: string;
}): Promise<BaselineCaseResult> {
  const eventTypes: string[] = [];
  const handle = stream({
    provider,
    model,
    ...requestOptions,
    providerTools: [webSearchTool],
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    maxOutputTokens: requestOptions.reasoning === true ? 12000 : 1024,
  });
  handle.on((event) => eventTypes.push(event.type));

  const result = await handle.final;
  if (!result.ok) return fail({ error: result.error, eventTypes });

  const text = getAssistantText(result.final);
  const citationPartCount = countCitationParts(result.final);
  const textCitationCount = countTextCitations(result.final);
  const citationEventCount = eventTypes.filter((type) => type === "citation").length;
  const providerToolPartCount = countProviderToolParts(result.final);
  const providerToolEventCount = eventTypes.filter((type) =>
    type.startsWith("provider-tool:"),
  ).length;
  const expectedEvidence = getWebSearchExpectedEvidence(providerId);
  return {
    ok: expectedEvidence.every((evidence) => {
      switch (evidence) {
        case "citation-part":
          return citationPartCount > 0;
        case "text-citation":
          return textCitationCount > 0;
        case "provider-tool":
          return providerToolPartCount > 0 || providerToolEventCount > 0;
      }
    }),
    details: {
      text,
      finishReason: result.final.finishReason,
      expectedEvidence,
      citationPartCount,
      textCitationCount,
      citationEventCount,
      providerToolPartCount,
      providerToolEventCount,
      eventTypes,
      usage: result.usage,
    },
  };
}

const addNumbersTool: ExecutableTool<
  z.ZodObject<{
    a: z.ZodNumber;
    b: z.ZodNumber;
  }>
> = {
  name: "add_numbers",
  description: "Add two numbers and return their sum.",
  schema: z.object({
    a: z.number(),
    b: z.number(),
  }),
  async execute(input) {
    return String(input.a + input.b);
  },
};

function fail(details: Record<string, unknown>): BaselineCaseResult {
  return { ok: false, details };
}

function getAssistantText(message: AxleAssistantMessage | undefined): string {
  if (!message) return "";
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function countCitationParts(message: AxleAssistantMessage | undefined): number {
  if (!message) return 0;
  return message.content.reduce(
    (total, part) => total + (part.type === "citation" ? part.citations.length : 0),
    0,
  );
}

function countTextCitations(message: AxleAssistantMessage | undefined): number {
  if (!message) return 0;
  return message.content.reduce(
    (total, part) => total + (part.type === "text" ? (part.citations?.length ?? 0) : 0),
    0,
  );
}

function countProviderToolParts(message: AxleAssistantMessage | undefined): number {
  if (!message) return 0;
  return message.content.filter((part) => part.type === "provider-tool").length;
}

function getWebSearchExpectedEvidence(
  providerId: string,
): Array<"citation-part" | "text-citation" | "provider-tool"> {
  switch (providerId) {
    case "openrouter":
      return ["citation-part"];
    case "gemini":
      return ["text-citation"];
    case "openai":
    case "anthropic":
      return ["provider-tool", "text-citation"];
    default:
      return ["text-citation"];
  }
}

function hasSuccessfulToolResult(messages: Array<{ role: string; content?: unknown }>): boolean {
  return getToolResultDetails(messages).some(
    (result) => result.isError !== true && result.content.includes("42"),
  );
}

function getToolResultDetails(
  messages: Array<{ role: string; content?: unknown }>,
): Array<{ name: string; isError?: boolean; content: string }> {
  return messages
    .filter((message) => message.role === "tool" && Array.isArray(message.content))
    .flatMap((message) =>
      (message.content as Array<{ name: string; isError?: boolean; content: unknown }>).map(
        (result) => ({
          name: result.name,
          isError: result.isError,
          content:
            typeof result.content === "string" ? result.content : JSON.stringify(result.content),
        }),
      ),
    );
}

function serializeError(error: unknown): unknown {
  if (!error) return undefined;
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}
