import { Agent, Transcript, isActionOf, isCall, type DeferredTool } from "@fifthrevision/axle";
import * as z from "zod";
import { fail } from "./helpers.js";
import type { CheckCase } from "./types.js";

const askUser = {
  type: "deferred",
  name: "ask_user",
  description:
    "Ask the person a question and wait for their answer. Use it whenever you need information only they have.",
  schema: z.object({
    question: z.string().describe("The question to put to the person"),
    options: z.array(z.string()).optional().describe("Choices to offer, if any"),
  }),
} satisfies DeferredTool;

const system =
  "You can ask the person questions with the ask_user tool. When told to ask them something, call the tool and wait for the answer before replying.";

export const deferredToolCases: CheckCase[] = [
  {
    group: "default",
    id: "deferred-tool-answered",
    description:
      "Agent offers a deferred tool, the model calls it, onToolCall answers, the model uses the answer.",
    async run({ provider, model, requestOptions }) {
      const agent = new Agent({ provider, model, ...requestOptions, system, tools: [askUser] });
      const transcript = new Transcript();
      agent.on(transcript.apply);
      const calls: Array<{ id: string; question: string }> = [];
      agent.onToolCall((call) => {
        if (isCall(askUser, call)) {
          calls.push({ id: call.id, question: call.input.question });
          return "teal";
        }
      });

      const result = await agent.send(
        "Ask me which colour I prefer, then reply with one sentence that names the colour I chose.",
      ).final;
      if (!result.ok) return fail({ error: result.error });

      const parts = transcript.turns
        .flatMap((turn) => turn.parts)
        .filter((part) => isActionOf(askUser, part));
      const roles = agent.messages.map((message) => message.role);
      const details = {
        response: result.response,
        calls,
        parts: parts.map((part) => ({
          status: part.status,
          callId: part.detail.callId,
          input: part.detail.input,
        })),
        roles,
        usage: result.usage,
      };
      const failureReasons: string[] = [];
      if (calls.length !== 1)
        failureReasons.push(`expected one ask_user call, got ${calls.length}`);
      if (!/teal/i.test(result.response)) failureReasons.push("response does not name the answer");
      if (parts.length !== 1 || parts[0].status !== "complete") {
        failureReasons.push("transcript has no completed deferred action");
      }
      if (parts[0] && calls[0] && parts[0].detail.callId !== calls[0].id) {
        failureReasons.push("part callId differs from the call id the handler saw");
      }
      if (roles.join(",") !== "user,assistant,tool,assistant") {
        failureReasons.push(`unexpected message roles: ${roles.join(",")}`);
      }
      return { ok: failureReasons.length === 0, failureReasons, details };
    },
  },
  {
    group: "extended",
    id: "deferred-tool-declined",
    description:
      "A handler that throws reaches the model as an error result and the turn still completes.",
    async run({ provider, model, requestOptions }) {
      const agent = new Agent({ provider, model, ...requestOptions, system, tools: [askUser] });
      agent.onToolCall(() => {
        throw new Error("The person dismissed the question without answering");
      });

      const result = await agent.send(
        "Ask me which colour I prefer. If you cannot get an answer, say so in one sentence.",
      ).final;
      if (!result.ok) return fail({ error: result.error });

      const toolMessage = agent.messages.find((message) => message.role === "tool");
      const toolResult = toolMessage?.role === "tool" ? toolMessage.content[0] : undefined;
      const details = { response: result.response, toolResult, usage: result.usage };
      const failureReasons: string[] = [];
      if (!toolResult) failureReasons.push("no tool result was committed");
      else if (!toolResult.isError || !String(toolResult.content).includes("dismissed")) {
        failureReasons.push("tool result is not the thrown error");
      }
      if (result.turn?.status !== "complete")
        failureReasons.push(`turn ended ${result.turn?.status}`);
      if (!result.response.trim()) failureReasons.push("empty final response");
      return { ok: failureReasons.length === 0, failureReasons, details };
    },
  },
];
