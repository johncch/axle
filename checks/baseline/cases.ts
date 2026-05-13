import * as z from "zod";
import {
  Agent,
  Instruct,
  generate,
  stream,
  type AIProvider,
  type AxleAssistantMessage,
  type ExecutableTool,
} from "../../src/index.js";

export interface BaselineCaseContext {
  provider: AIProvider;
  model: string;
  providerId: string;
}

export interface BaselineCaseResult {
  ok: boolean;
  details?: Record<string, unknown>;
}

export interface BaselineCase {
  id: string;
  description: string;
  run(context: BaselineCaseContext): Promise<BaselineCaseResult>;
}

const answerSchema = {
  answer: z.string(),
  count: z.number(),
  ok: z.boolean(),
};

export const baselineCases: BaselineCase[] = [
  {
    id: "generate-basic",
    description: "Basic generate() text response.",
    async run({ provider, model }) {
      const result = await generate({
        provider,
        model,
        messages: [{ role: "user", content: "Reply with exactly: pong" }],
      });

      if (result.result === "error") return fail({ error: result.error });
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
    async run({ provider, model }) {
      const textDeltas: string[] = [];
      const handle = stream({
        provider,
        model,
        messages: [{ role: "user", content: "Reply with exactly: pong" }],
      });
      handle.on((event) => {
        if (event.type === "text:delta") textDeltas.push(event.delta);
      });

      const result = await handle.final;
      if (result.result === "error") return fail({ error: result.error });
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
    async run({ provider, model }) {
      const result = await generate({
        provider,
        model,
        instruct: new Instruct("Return answer='pong', count=3, ok=true.", answerSchema),
      });

      if (result.result === "error") return fail({ error: result.error });
      return {
        ok: Boolean(
          result.response?.answer.toLowerCase().includes("pong") &&
          result.response.count === 3 &&
          result.response.ok === true,
        ),
        details: { response: result.response, parseError: serializeError(result.parseError) },
      };
    },
  },
  {
    id: "stream-instruct-json",
    description: "stream() with Instruct structured JSON response.",
    async run({ provider, model }) {
      const handle = stream({
        provider,
        model,
        instruct: new Instruct("Return answer='pong', count=3, ok=true.", answerSchema),
      });
      const result = await handle.final;

      if (result.result === "error") return fail({ error: result.error });
      return {
        ok: Boolean(
          result.response?.answer.toLowerCase().includes("pong") &&
          result.response.count === 3 &&
          result.response.ok === true,
        ),
        details: { response: result.response, parseError: serializeError(result.parseError) },
      };
    },
  },
  {
    id: "generate-instruct-history",
    description: "generate() uses historical messages plus latest Instruct turn.",
    async run({ provider, model }) {
      const result = await generate({
        provider,
        model,
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
        instruct: new Instruct("What is the code word?", { word: z.string() }),
      });

      if (result.result === "error") return fail({ error: result.error });
      return {
        ok: result.response?.word.toLowerCase().includes("lavender") ?? false,
        details: { response: result.response, parseError: serializeError(result.parseError) },
      };
    },
  },
  {
    id: "agent-basic",
    description: "Agent basic send() text response and history.",
    async run({ provider, model }) {
      const agent = new Agent({ provider, model });
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
    async run({ provider, model }) {
      const agent = new Agent({ provider, model });
      const result = await agent.send(
        new Instruct("Return answer='pong', count=3, ok=true.", answerSchema),
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
    async run({ provider, model }) {
      const agent = new Agent({ provider, model });
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
    async run({ provider, model }) {
      const result = await generate({
        provider,
        model,
        messages: [
          {
            role: "user",
            content: "Use the add_numbers tool to add 17 and 25. Then answer with the result.",
          },
        ],
        tools: [addNumbersTool],
      });

      if (result.result === "error") return fail({ error: result.error });
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
    async run({ provider, model }) {
      let toolRequestCount = 0;
      const handle = stream({
        provider,
        model,
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
      if (result.result === "error") return fail({ error: result.error });
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
    async run({ provider, model }) {
      const agent = new Agent({ provider, model, tools: [addNumbersTool] });
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

      if (result.result === "error") return fail({ error: result.error });
      const text = getAssistantText(result.final);
      return {
        ok: text.toLowerCase().includes("pong"),
        details: { text, usage: result.usage },
      };
    },
  },
  {
    id: "instruct-text-reference",
    description: "Instruct text references are included in the user turn.",
    async run({ provider, model }) {
      const instruct = new Instruct("Return the project code from the reference.", {
        code: z.string(),
      });
      instruct.addFile("Project code: orchid-17", { name: "project-note" });

      const result = await generate({ provider, model, instruct });
      if (result.result === "error") return fail({ error: result.error });
      return {
        ok: result.response?.code.toLowerCase().includes("orchid-17") ?? false,
        details: { response: result.response, parseError: serializeError(result.parseError) },
      };
    },
  },
];

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
