import {
  Agent,
  AxleAgentAbortError,
  AxleToolFatalError,
  Instruct,
  createAgentTool,
  generate,
  loadFileContent,
  parallelize,
  stream,
  type AIProvider,
  type AxleAssistantMessage,
  type AxleModelRequestOptions,
  type ExecutableTool,
  type FileResolver,
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
    id: "generate-deferred-tool-file",
    description: "generate() resolves a deferred text file returned by a local tool.",
    async run({ provider, model, requestOptions }) {
      const schema = z.object({});
      const readProjectNote: ExecutableTool<typeof schema> = {
        name: "read_project_note",
        description: "Read the project note containing the project code.",
        schema,
        async execute() {
          return [
            {
              type: "file",
              file: {
                kind: "text",
                mimeType: "text/plain",
                name: "project-note.txt",
                source: { type: "ref", ref: { id: "project-note" } },
              },
            },
          ];
        },
      };

      let resolutionCount = 0;
      const fileResolver: FileResolver = async ({ ref, accepted }) => {
        resolutionCount += 1;
        if (!accepted.includes("text")) {
          throw new Error(`Expected text resolution, received: ${accepted.join(", ")}`);
        }
        if (
          typeof ref !== "object" ||
          ref === null ||
          !("id" in ref) ||
          ref.id !== "project-note"
        ) {
          throw new Error("Unexpected deferred file ref");
        }
        return { type: "text", content: "Project code: deferred-orchid-17" };
      };

      const result = await generate({
        provider,
        model,
        ...requestOptions,
        messages: [
          {
            role: "user",
            content:
              "Use read_project_note to read the project note. Then answer with the project code.",
          },
        ],
        tools: [readProjectNote],
        fileResolver,
      });

      if (!result.ok) return fail({ error: result.error });
      const text = getAssistantText(result.final).toLowerCase();
      const toolResults = getToolResultDetails(result.messages);
      const deferredResult = toolResults.find((item) => item.name === "read_project_note");
      return {
        ok:
          text.includes("deferred-orchid-17") &&
          resolutionCount > 0 &&
          deferredResult?.content.includes('"type":"ref"') === true,
        details: {
          text,
          resolutionCount,
          toolResults,
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
    id: "generate-parallelized-tool",
    description: "generate() executes a generated batch tool and reaches a final answer.",
    async run({ provider, model, requestOptions }) {
      const lookupTool: ExecutableTool<
        z.ZodObject<{
          id: z.ZodString;
        }>
      > = {
        name: "lookup_code",
        description: "Lookup a fixed code by id.",
        schema: z.object({
          id: z.string(),
        }),
        async execute(input) {
          if (input.id === "alpha") return "alpha=orchid";
          if (input.id === "beta") return "beta=violet";
          return `${input.id}=unknown`;
        },
      };
      const lookupBatchTool = parallelize(lookupTool, {
        name: "lookup_codes",
        description: "Lookup multiple fixed codes by id.",
      });

      const result = await generate({
        provider,
        model,
        ...requestOptions,
        messages: [
          {
            role: "user",
            content:
              "Use the lookup_codes tool once to look up ids alpha and beta. Then answer with both code words.",
          },
        ],
        tools: [lookupBatchTool],
      });

      if (!result.ok) return fail({ error: result.error });
      const text = getAssistantText(result.final);
      const toolResults = getToolResultDetails(result.messages);
      return {
        ok:
          text.toLowerCase().includes("orchid") &&
          text.toLowerCase().includes("violet") &&
          toolResults.some(
            (toolResult) =>
              toolResult.name === "lookup_codes" &&
              toolResult.content.includes("orchid") &&
              toolResult.content.includes("violet"),
          ),
        details: {
          text,
          toolResults,
          messageCount: result.messages.length,
          usage: result.usage,
        },
      };
    },
  },
  {
    id: "agent-subagent-tool",
    description: "Agent delegates to a child agent exposed as a tool.",
    async run({ provider, model, requestOptions }) {
      const subagentTool = createAgentTool({
        name: "delegate_code_word",
        description: "Delegate a code-word lookup task to a child agent.",
        schema: z.object({
          task: z.string(),
        }),
        createAgent: () =>
          new Agent({
            provider,
            model,
            ...requestOptions,
            system: "You are a child agent. Reply with exactly the requested code word.",
          }),
        prompt: () => "Reply with exactly: subagent-orchid",
      });
      const agent = new Agent({ provider, model, ...requestOptions, tools: [subagentTool] });
      const result = await agent.send(
        "Use delegate_code_word to get the code word. Then answer with only that code word.",
      ).final;
      const text = String(result.response ?? "");
      const toolResults = getToolResultDetails(agent.history.log);

      return {
        ok:
          text.includes("subagent-orchid") &&
          result.usage.breakdown?.some(
            (entry) =>
              entry.provider === provider.name &&
              // Attribution uses the runtime model, which may be a dated
              // snapshot of the requested one (e.g. gpt-5.4-mini-2026-03-17).
              entry.model.startsWith(model) &&
              entry.in > 0 &&
              entry.out > 0,
          ) === true &&
          toolResults.some(
            (toolResult) =>
              toolResult.name === "delegate_code_word" &&
              toolResult.content.includes("subagent-orchid"),
          ),
        details: {
          response: result.response,
          toolResults,
          turnCount: agent.history.turns.length,
          usage: result.usage,
        },
      };
    },
  },
  {
    id: "agent-tool-fatal",
    description: "Fatal tool error terminates the send with usage and intact history.",
    async run({ provider, model, requestOptions }) {
      const fatalTool: ExecutableTool<z.ZodObject<{ id: z.ZodString }>> = {
        name: "fetch_record",
        description: "Fetch a record from the datastore by id.",
        schema: z.object({ id: z.string() }),
        async execute() {
          throw new AxleToolFatalError("datastore credentials revoked", {
            toolName: "fetch_record",
          });
        },
      };
      const agent = new Agent({ provider, model, ...requestOptions, tools: [fatalTool] });

      let thrown: unknown;
      try {
        await agent.send("Call fetch_record with id 'r-123' and report what it returns.").final;
      } catch (error) {
        thrown = error;
      }

      const fatal = thrown instanceof AxleToolFatalError ? thrown : undefined;
      const logRoles = agent.history.log.map((message) => message.role);
      return {
        ok: Boolean(
          fatal &&
          fatal.usage &&
          fatal.usage.in > 0 &&
          fatal.usage.out > 0 &&
          logRoles.length === 2 &&
          logRoles[0] === "user" &&
          logRoles[1] === "assistant",
        ),
        details: {
          error: serializeError(thrown),
          logRoles,
          usage: fatal?.usage,
        },
      };
    },
  },
  {
    id: "agent-subagent-abort",
    description: "Cancelling mid-delegation aborts cleanly without leaking the child conversation.",
    async run({ provider, model, requestOptions }) {
      const subagentTool = createAgentTool({
        name: "delegate_essay",
        description: "Delegate a long writing task to a child agent.",
        schema: z.object({ topic: z.string() }),
        createAgent: () =>
          new Agent({
            provider,
            model,
            ...requestOptions,
            system: "You are a thorough writer.",
          }),
        prompt: (input) => `Write a 500-word essay about ${input.topic}.`,
      });
      const agent = new Agent({ provider, model, ...requestOptions, tools: [subagentTool] });

      let sawChildEvent = false;
      let handleRef: { cancel: (reason?: unknown) => void } | undefined;
      agent.on((event) => {
        if (event.type === "action:child-event" && !sawChildEvent) {
          sawChildEvent = true;
          handleRef?.cancel("baseline-abort");
        }
      });

      const handle = agent.send(
        "Use delegate_essay to write an essay about typography, then summarize it in one line.",
      );
      handleRef = handle;

      let thrown: unknown;
      try {
        await handle.final;
      } catch (error) {
        thrown = error;
      }

      const aborted = thrown instanceof AxleAgentAbortError ? thrown : undefined;
      const messageRoles = aborted?.messages?.map((message) => message.role) ?? [];
      // A leaked child conversation would contain the delegated user prompt.
      const noChildLeak = messageRoles.length === 1 && messageRoles[0] === "assistant";
      return {
        ok: Boolean(
          aborted && sawChildEvent && noChildLeak && aborted.usage && aborted.usage.in > 0,
        ),
        details: {
          sawChildEvent,
          messageRoles,
          error: serializeError(thrown),
          usage: aborted?.usage,
        },
      };
    },
  },
  {
    id: "agent-parallel-subagents",
    description:
      "parallelize(createAgentTool) fans out subagents with per-item results and merged usage.",
    async run({ provider, model, requestOptions }) {
      const codeWords: Record<string, string> = {
        alpha: "obsidian",
        beta: "lantern",
        gamma: "meridian",
      };
      const subagentTool = createAgentTool({
        name: "lookup_code_word",
        description: "Delegate a code-word lookup to a child agent.",
        schema: z.object({ key: z.string() }),
        createAgent: () =>
          new Agent({
            provider,
            model,
            ...requestOptions,
            system: "Reply with exactly the requested code word and nothing else.",
          }),
        prompt: (input) => `Reply with exactly: ${codeWords[input.key] ?? "unknown"}`,
      });
      const batch = parallelize(subagentTool, { maxConcurrency: 3 });
      const agent = new Agent({ provider, model, ...requestOptions, tools: [batch] });

      let childEvents = 0;
      agent.on((event) => {
        if (event.type === "action:child-event") childEvents += 1;
      });

      const result = await agent.send(
        "Call lookup_code_word_batch once with items for the keys alpha, beta, and gamma. " +
          "Then reply with the three code words.",
      ).final;
      if (!result.ok) return fail({ error: result.error });

      const text = String(result.response ?? "").toLowerCase();
      const batchResult = getToolResultDetails(agent.history.log).find(
        (toolResult) => toolResult.name === "lookup_code_word_batch",
      );
      let itemsOk = false;
      if (batchResult) {
        try {
          const parsed = JSON.parse(batchResult.content) as {
            results: Array<{ input: { key: string }; ok: boolean; output?: string }>;
          };
          itemsOk =
            parsed.results.length === 3 &&
            parsed.results.every(
              (item) => item.ok && String(item.output ?? "").includes(codeWords[item.input.key]),
            );
        } catch {
          itemsOk = false;
        }
      }

      return {
        ok: Boolean(
          itemsOk &&
          childEvents > 0 &&
          Object.values(codeWords).every((word) => text.includes(word)),
        ),
        details: {
          text,
          childEvents,
          batchResult: batchResult?.content,
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
