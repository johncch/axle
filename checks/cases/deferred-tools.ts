import { Agent, Transcript, isCall, type DeferredTool } from "@fifthrevision/axle";
import { analyze, completed, failed, named } from "@fifthrevision/axle/analyze";
import * as z from "zod";
import { fail } from "./helpers.js";
import type { CheckCase } from "./types.js";

export const askUser = {
  type: "deferred",
  name: "ask_user",
  description:
    "Ask the person a question and wait for their answer. Use it whenever you need information only they have.",
  schema: z.object({
    question: z.string().describe("The question to put to the person"),
    options: z.array(z.string()).optional().describe("Choices to offer, if any"),
  }),
} satisfies DeferredTool;

export const system =
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

      const asks = analyze(transcript.turns).tools.filter(named(askUser.name));
      const roles = agent.messages.map((message) => message.role);
      const details = {
        response: result.response,
        calls,
        asks: asks.map((ask) => ({
          kind: ask.kind,
          status: ask.status,
          callId: ask.callId,
          input: ask.parameters,
        })),
        roles,
        usage: result.usage,
      };
      const failureReasons: string[] = [];
      if (calls.length !== 1)
        failureReasons.push(`expected one ask_user call, got ${calls.length}`);
      if (!/teal/i.test(result.response)) failureReasons.push("response does not name the answer");
      if (asks.length !== 1 || asks[0].kind !== "deferred" || !completed(asks[0])) {
        failureReasons.push("transcript has no completed deferred action");
      }
      if (asks[0] && calls[0] && asks[0].callId !== calls[0].id) {
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
      const transcript = new Transcript();
      agent.on(transcript.apply);
      agent.onToolCall(() => {
        throw new Error("The person dismissed the question without answering");
      });

      const result = await agent.send(
        "Ask me which colour I prefer. If you cannot get an answer, say so in one sentence.",
      ).final;
      if (!result.ok) return fail({ error: result.error });

      const toolMessage = agent.messages.find((message) => message.role === "tool");
      const toolResult = toolMessage?.role === "tool" ? toolMessage.content[0] : undefined;
      const declined = analyze(transcript.turns).tools.filter(failed);
      const details = {
        response: result.response,
        toolResult,
        declined: declined.map((call) => ({
          kind: call.kind,
          error: call.error,
          recovered: call.recovered,
        })),
        usage: result.usage,
      };
      const failureReasons: string[] = [];
      if (!toolResult) failureReasons.push("no tool result was committed");
      else if (!toolResult.isError || !String(toolResult.content).includes("dismissed")) {
        failureReasons.push("tool result is not the thrown error");
      }
      if (declined.length !== 1 || declined[0].kind !== "deferred" || !declined[0].recovered) {
        failureReasons.push("transcript has no failed deferred call recorded as recovered");
      }
      if (result.turn?.status !== "complete")
        failureReasons.push(`turn ended ${result.turn?.status}`);
      if (!result.response.trim()) failureReasons.push("empty final response");
      return { ok: failureReasons.length === 0, failureReasons, details };
    },
  },
];
