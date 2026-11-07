import {
  Agent,
  InMemoryEventStore,
  Instruct,
  isActionOf,
  isCall,
  loopbackTransport,
  RemoteAgent,
  Transcript,
} from "@fifthrevision/axle";
import * as z from "zod";
import { askUser, system } from "./deferred-tools.js";
import { fail } from "./helpers.js";
import type { CheckCase } from "./types.js";

export const remoteAgentCases: CheckCase[] = [
  {
    group: "extended",
    id: "remote-agent-roundtrip",
    description:
      "An Instruct with a schema crosses as JSON Schema, the model calls ask_user, a RemoteAgent answers, and the response parses with the schema this side holds.",
    async run({ provider, model, requestOptions }) {
      const agent = new Agent({ provider, model, ...requestOptions, system, tools: [askUser] });
      const remote = new RemoteAgent(loopbackTransport(agent, new InMemoryEventStore(agent)));
      const transcript = new Transcript();
      remote.on(transcript.apply);
      const calls: Array<{ id: string; question: string }> = [];
      remote.onToolCall((call) => {
        if (isCall(askUser, call)) {
          calls.push({ id: call.id, question: call.input.question });
          return "teal";
        }
      });
      const schema = z.object({
        colour: z.string().describe("The colour the person chose, in lowercase"),
        reason: z.string().optional().describe("One sentence on why they might like it"),
        confidence: z.number().describe("How sure you are they chose it, 0 to 1"),
      });

      const result = await remote.send(
        new Instruct({
          prompt: "Ask me which colour I prefer, then report the colour I chose.",
          schema,
        }),
      ).final;
      remote.close();
      if (!result.ok) return fail({ error: result.error });

      const parts = transcript.turns
        .flatMap((turn) => turn.parts)
        .filter((part) => isActionOf(askUser, part));
      const roles = agent.messages.map((message) => message.role);
      const details = {
        response: result.response,
        calls,
        parts: parts.map((part) => ({ status: part.status, callId: part.detail.callId })),
        roles,
        usage: result.usage,
      };
      const failureReasons: string[] = [];
      if (calls.length !== 1)
        failureReasons.push(`expected one ask_user call, got ${calls.length}`);
      if (!/teal/i.test(result.response.colour))
        failureReasons.push("parsed colour is not the answer");
      if (typeof result.response.confidence !== "number")
        failureReasons.push("parsed confidence is not a number");
      if (parts.length !== 1 || parts[0].status !== "complete") {
        failureReasons.push("transcript has no completed deferred action");
      }
      if (roles.join(",") !== "user,assistant,tool,assistant") {
        failureReasons.push(`unexpected message roles: ${roles.join(",")}`);
      }
      return { ok: failureReasons.length === 0, failureReasons, details };
    },
  },
];
