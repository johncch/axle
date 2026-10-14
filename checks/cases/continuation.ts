import { Agent, Transcript, type Turn } from "@fifthrevision/axle";
import type { CheckCase } from "./types.js";

function turnText(turn: Turn | undefined): string {
  if (!turn) return "";
  return turn.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export const continuationCases: CheckCase[] = [
  {
    group: "default",
    id: "agent-continuation",
    description:
      "A send's continuation judges the reply and runs a correction inline, ahead of a message queued during the judge.",
    async run({ provider, model, requestOptions }) {
      const agent = new Agent({ provider, model, ...requestOptions });
      const transcript = new Transcript();
      agent.on((event) => transcript.apply(event));
      const settledIds: string[] = [];
      agent.onSettled((_session, operation) => {
        settledIds.push(operation.id);
      });

      const approved = (text: string): boolean => text.trim().toUpperCase().endsWith("APPROVED");
      let judgeRan = 0;
      const handle = agent.send("What color is a clear daytime sky? Reply with one word.", {
        after: async (result, ctx) => {
          let text = String(result.response ?? "");
          for (let attempt = 0; attempt < 2 && !approved(text); attempt++) {
            judgeRan += 1;
            const correction = await ctx.send(
              "Repeat your previous one-word answer followed by the word APPROVED, and nothing else.",
            );
            text = String(correction.response ?? "");
          }
        },
      });
      const queued = agent.send("Reply exactly: done.");
      const result = await handle.final;
      const second = await queued.final;

      const userTexts = transcript.turns
        .filter((turn) => turn.owner === "user")
        .map((turn) => turnText(turn));
      const lastInline = result.after.at(-1);
      const failureReasons = [
        ...(result.after.length === 0 ? ["The continuation ran no inline turn."] : []),
        ...(lastInline && !approved(String(lastInline.response ?? ""))
          ? ["The last correction was not approved by the judge."]
          : []),
        ...(userTexts.at(-1) !== "Reply exactly: done."
          ? [`The queued message did not run last; user turns were ${JSON.stringify(userTexts)}.`]
          : []),
        ...(settledIds.length !== 2 + result.after.length
          ? [`Expected ${2 + result.after.length} settles, received ${settledIds.length}.`]
          : []),
        ...(!String(second.response ?? "")
          .toLowerCase()
          .includes("done")
          ? ["The queued message did not get its own reply."]
          : []),
      ];

      return {
        ok: failureReasons.length === 0,
        ...(failureReasons.length > 0 ? { failureReasons } : {}),
        details: {
          response: result.response,
          corrections: result.after.map((turn) => turn.response),
          judgeRan,
          userTexts,
          settles: settledIds.length,
        },
      };
    },
  },
];
