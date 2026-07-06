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
  failureReasons?: string[];
  details?: Record<string, unknown>;
}

export interface BaselineCaseExclusion {
  provider: BaselineProviderId;
  model?: RegExp;
  reason: string;
}

export interface BaselineCase {
  id: string;
  description: string;
  providers?: BaselineProviderId[];
  exclusions?: BaselineCaseExclusion[];
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
      const lastMessage = agent.history.messages.at(-1);
      const finishReason = lastMessage?.role === "assistant" ? lastMessage.finishReason : undefined;
      const failureReasons = [
        ...(!text.toLowerCase().includes("lavender")
          ? [
              text.length === 0 && finishReason === "length"
                ? "Second turn reached the provider output limit without producing visible text."
                : "Second turn did not recall the lavender code word.",
            ]
          : []),
        ...(agent.history.turns.length !== 4
          ? [`Expected 4 history turns, received ${agent.history.turns.length}.`]
          : []),
      ];

      return {
        ok: failureReasons.length === 0,
        ...(failureReasons.length > 0 ? { failureReasons } : {}),
        details: {
          response: result.response,
          finishReason,
          turnCount: agent.history.turns.length,
          usage: result.usage,
        },
      };
    },
  },
  {
    id: "agent-compaction",
    description:
      "Agent compacts history via a model-written summary and the compacted conversation continues.",
    async run({ provider, model, requestOptions }) {
      // Reasoning smoke models (e.g. Together's Qwen) can spend the provider's
      // default output budget on thinking; give the whole case headroom.
      const caseOptions = { ...requestOptions, maxOutputTokens: 8192 };
      const agent = new Agent({ provider, model, ...caseOptions });
      await agent.send("For this conversation, the code word is lavender. Reply exactly: stored.")
        .final;
      await agent.send("Also remember: the magic number is 7. Reply exactly: stored.").final;

      const messagesBefore = agent.history.messages.length;

      agent.onCompaction(async ({ messages }, { signal }) => {
        const summary = await generate({
          provider,
          model,
          ...caseOptions,
          signal,
          messages: [
            {
              role: "user",
              content:
                "Summarize this conversation for a fresh assistant taking over. " +
                "Preserve any code words and numbers verbatim.\n\n" +
                JSON.stringify(messages),
            },
          ],
        });
        if (!summary.ok) return null;
        const text = getAssistantText(summary.final);
        if (!text) return null;
        return [{ role: "user", content: `Summary of the conversation so far: ${text}` }];
      });

      const record = await agent.compact();
      const activeAfter = agent.history.messages.length;
      const archiveAfter = agent.history.archive.length;
      const compactionTurn = agent.history.turns.find((turn) =>
        turn.parts.some((part) => part.type === "compaction"),
      );

      const result = await agent.send("Using only our conversation so far, what is the code word?")
        .final;
      const text = String(result.response ?? "");

      const failureReasons = [
        ...(record == null
          ? ["compact() returned null; the callback declined or was skipped."]
          : []),
        ...(agent.history.compactions.length !== 1
          ? [`Expected 1 compaction record, got ${agent.history.compactions.length}.`]
          : []),
        ...(activeAfter >= messagesBefore
          ? [`Active history did not shrink: ${messagesBefore} -> ${activeAfter}.`]
          : []),
        ...(archiveAfter !== messagesBefore
          ? [`Archive should retain the ${messagesBefore} raw messages, got ${archiveAfter}.`]
          : []),
        ...(compactionTurn?.status !== "complete"
          ? [`Expected a complete compaction turn, got ${compactionTurn?.status ?? "none"}.`]
          : []),
        ...(!text.toLowerCase().includes("lavender")
          ? ["Post-compaction turn did not recall the lavender code word."]
          : []),
      ];

      return {
        ok: failureReasons.length === 0,
        ...(failureReasons.length > 0 ? { failureReasons } : {}),
        details: {
          response: result.response,
          record,
          messagesBefore,
          activeAfter,
          archiveAfter,
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
      const expectedCode = "deferred-orchid-17";
      const checks = {
        finalAnswerContainsExpectedCode: text.includes(expectedCode),
        resolverWasCalled: resolutionCount > 0,
        historyPreservedDeferredRef: deferredResult?.content.includes('"type":"ref"') === true,
      };
      const failureReasons = [
        ...(!checks.finalAnswerContainsExpectedCode
          ? [`Final assistant text did not contain expected code '${expectedCode}'.`]
          : []),
        ...(!checks.resolverWasCalled ? ["FileResolver was not called."] : []),
        ...(!checks.historyPreservedDeferredRef
          ? ["Tool-result history did not preserve the deferred ref source."]
          : []),
      ];
      return {
        ok: failureReasons.length === 0,
        failureReasons,
        details: {
          expectedCode,
          text,
          resolutionCount,
          checks,
          toolResults,
          usage: result.usage,
        },
      };
    },
  },
  {
    id: "generate-unsupported-tool-file",
    description: "Chat Completions continues when a local tool returns an unsupported binary file.",
    providers: ["openrouter"],
    async run({ provider, model, requestOptions }) {
      const schema = z.object({});
      const captureImage: ExecutableTool<typeof schema> = {
        name: "capture_image",
        description: "Capture and return an image attachment.",
        schema,
        async execute() {
          return [
            { type: "text", text: "Captured image:" },
            {
              type: "file",
              file: {
                kind: "image",
                mimeType: "image/png",
                name: "capture.png",
                source: { type: "base64", data: "iVBORw0KGgo=" },
              },
            },
          ];
        },
      };

      const result = await generate({
        provider,
        model,
        ...requestOptions,
        messages: [
          {
            role: "user",
            content:
              "Call capture_image. If its result says the attachment was not included, reply exactly: attachment unavailable.",
          },
        ],
        tools: [captureImage],
      });

      if (!result.ok) return fail({ error: result.error });
      const text = getAssistantText(result.final).toLowerCase();
      const toolResults = getToolResultDetails(result.messages);
      const captureResult = toolResults.find((toolResult) => toolResult.name === "capture_image");
      const checks = {
        finalAnswerAcknowledgedUnavailableAttachment: text.includes("attachment unavailable"),
        captureToolSucceeded:
          captureResult?.isError !== true &&
          captureResult?.content.includes('"name":"capture.png"') === true,
      };
      const failureReasons = [
        ...(!checks.finalAnswerAcknowledgedUnavailableAttachment
          ? ["Final assistant text did not acknowledge the unavailable attachment."]
          : []),
        ...(!checks.captureToolSucceeded
          ? ["capture_image did not return a successful capture.png tool result."]
          : []),
      ];
      return {
        ok: failureReasons.length === 0,
        ...(failureReasons.length > 0 ? { failureReasons } : {}),
        details: {
          text,
          checks,
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
        ok: text.includes("42") && hasSuccessfulToolResult(agent.history.messages),
        details: {
          response: result.response,
          toolResults: getToolResultDetails(agent.history.messages),
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
      const toolResults = getToolResultDetails(agent.history.messages);
      const parentReturnedCodeWord = text.toLowerCase().includes("orchid");
      const childReturnedExpectedValue = toolResults.some(
        (toolResult) =>
          toolResult.name === "delegate_code_word" &&
          toolResult.content.includes("subagent-orchid"),
      );
      const usageAttributed =
        result.usage.breakdown?.some(
          (entry) =>
            entry.provider === provider.name &&
            entry.model.startsWith(model) &&
            entry.in > 0 &&
            entry.out > 0,
        ) === true;
      const failureReasons = [
        ...(!parentReturnedCodeWord
          ? ["Parent response did not preserve the orchid code word."]
          : []),
        ...(!childReturnedExpectedValue
          ? ["Child tool result did not contain subagent-orchid."]
          : []),
        ...(!usageAttributed ? ["Child usage was not attributed to the provider and model."] : []),
      ];

      return {
        ok: failureReasons.length === 0,
        ...(failureReasons.length > 0 ? { failureReasons } : {}),
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
      const logRoles = agent.history.messages.map((message) => message.role);
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
      const batchResult = getToolResultDetails(agent.history.messages).find(
        (toolResult) => toolResult.name === "lookup_code_word_batch",
      );
      const batchContent = batchResult?.content ?? "";
      const itemsOk =
        Boolean(batchResult) &&
        [0, 1, 2].every((index) =>
          batchContent.includes(`<<result {\\"index\\":${index},\\"ok\\":true}>>`),
        ) &&
        Object.values(codeWords).every((word) => batchContent.includes(word));

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
    description: "stream() uses native or fallback web search and surfaces execution evidence.",
    async run({ provider, model, requestOptions }) {
      return runStreamingWebSearchCitationCase({
        provider,
        model,
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
    id: "instruct-context",
    description: "Instruct supporting context is included separately from the authored prompt.",
    async run({ provider, model, requestOptions }) {
      const instruct = new Instruct({
        prompt: "Return the sandbox entry point from the supplied context.",
        schema: z.object({
          entryPoint: z.string(),
        }),
      });
      instruct.addContext("Sandbox files:\n- src/main.ts\n- package.json", {
        title: "File manifest",
      });

      const result = await generate({ provider, model, ...requestOptions, instruct });
      if (!result.ok) return fail({ error: result.error });
      return {
        ok: result.response?.entryPoint.includes("src/main.ts") ?? false,
        details: { response: result.response },
      };
    },
  },
  {
    id: "generate-image-file",
    description: "generate() with an Instruct image file attachment.",
    exclusions: [
      {
        provider: "together",
        model: /^deepseek-ai\/DeepSeek-V4-Pro$/i,
        reason: "Together reports that DeepSeek V4 Pro does not support multimodal input.",
      },
    ],
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
    providers: ["openai", "anthropic", "gemini", "openrouter"],
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
  requestOptions,
  prompt,
}: {
  provider: AIProvider;
  model: string;
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
  const toolExecutionCount = eventTypes.filter((type) => type === "tool:exec-complete").length;
  const webSearchToolResults = getToolResultDetails(result.messages).filter(
    (toolResult) => toolResult.name === "web_search" && toolResult.isError !== true,
  );
  const nativeSearchAvailable =
    provider.resolveProviderToolName?.("web_search", model) !== undefined;
  const unexpectedFallback = nativeSearchAvailable && webSearchToolResults.length > 0;
  const searchEvidence = {
    citations: citationPartCount + textCitationCount + citationEventCount > 0,
    providerTool: providerToolPartCount + providerToolEventCount > 0,
    webSearchTool: webSearchToolResults.length > 0,
  };
  const hasSearchEvidence = Object.values(searchEvidence).some(Boolean) && !unexpectedFallback;
  return {
    ok: hasSearchEvidence,
    ...(!hasSearchEvidence
      ? {
          failureReasons: [
            unexpectedFallback
              ? "Provider reported native web_search support but Axle used the configured fallback."
              : "No citations, provider-tool activity, or successful web_search result.",
          ],
        }
      : {}),
    details: {
      text,
      finishReason: result.final.finishReason,
      nativeSearchAvailable,
      unexpectedFallback,
      searchEvidence,
      citationPartCount,
      textCitationCount,
      citationEventCount,
      providerToolPartCount,
      providerToolEventCount,
      toolExecutionCount,
      webSearchToolResultCount: webSearchToolResults.length,
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
