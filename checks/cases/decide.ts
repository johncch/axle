import { AxleError, choice, decide, noul, score } from "@fifthrevision/axle";
import type { DecisionCheckCase } from "./types.js";

const ticket = {
  customer_tier: "enterprise",
  ticket: "My checkout page shows a blank screen after I click Pay. I have tried two browsers.",
};

const teams = ["payments", "frontend", "account"];
const urgencyLevels = [
  "Can wait for the next release",
  "Should be fixed this week",
  "Blocking revenue right now",
];

function isProbability(value: number): boolean {
  return value >= 0 && value <= 1;
}

export const decideCases: DecisionCheckCase[] = [
  {
    kind: "decision",
    id: "decide-basic",
    description: "decide() answers a noul, a choice, and a score question in one request.",
    group: "default",
    async run({ provider, model }) {
      const result = await decide({
        provider,
        model,
        input: ticket,
        questions: {
          is_bug: noul("Is the customer reporting a software defect?", {
            true: "The customer describes broken or unexpected product behavior.",
            false: "The customer is asking a question or requesting a feature.",
          }),
          team: choice("Which team should own this ticket?", {
            payments: "Checkout, billing, or payment processing issues.",
            frontend: "Rendering, layout, or browser compatibility issues.",
            account: null,
          }),
          urgency: score("How urgent is this ticket?", urgencyLevels),
        },
      });

      const { is_bug, team, urgency } = result.answers;
      const failureReasons: string[] = [];

      if (is_bug.type !== "noul") {
        failureReasons.push(`is_bug came back as ${is_bug.type}`);
      } else if (!isProbability(is_bug.noul)) {
        failureReasons.push(`is_bug.noul ${is_bug.noul} is outside 0..1`);
      }

      if (team.type !== "choice") {
        failureReasons.push(`team came back as ${team.type}`);
      } else {
        if (!teams.includes(team.choice)) {
          failureReasons.push(`team.choice "${team.choice}" is not one of the options`);
        }
        if (Object.keys(team.probabilities).sort().join() !== [...teams].sort().join()) {
          failureReasons.push("team.probabilities does not have one entry per option");
        }
        if (!isProbability(team.confidence)) {
          failureReasons.push(`team.confidence ${team.confidence} is outside 0..1`);
        }
      }

      if (urgency.type !== "score") {
        failureReasons.push(`urgency came back as ${urgency.type}`);
      } else {
        if (urgency.score < 0 || urgency.score > urgencyLevels.length - 1) {
          failureReasons.push(`urgency.score ${urgency.score} is off the scale`);
        }
        if (Object.values(urgency.legend).join("|") !== urgencyLevels.join("|")) {
          failureReasons.push("urgency.legend does not echo the levels in order");
        }
      }

      if (result.usage.in <= 0) failureReasons.push("usage.in was not reported");

      return {
        ok: failureReasons.length === 0,
        failureReasons,
        details: { model: result.model, answers: result.answers, usage: result.usage },
      };
    },
  },
  {
    kind: "decision",
    id: "decide-rejects-unknown-model",
    description: "decide() surfaces a rejected request as an AxleError carrying the HTTP status.",
    group: "default",
    async run({ provider }) {
      try {
        const result = await decide({
          provider,
          model: "axle-check-no-such-model",
          input: "text",
          questions: { any: noul("Is this text?") },
        });
        return {
          ok: false,
          failureReasons: ["An unknown model was answered instead of rejected."],
          details: { model: result.model, answers: result.answers },
        };
      } catch (error) {
        if (!(error instanceof AxleError)) throw error;
        const status = error.details?.status;
        const rejected = error.code === "DECISION_REQUEST_FAILED" && status >= 400 && status < 500;
        return {
          ok: rejected,
          failureReasons: rejected ? [] : [`Unexpected failure: ${error.code} ${error.message}`],
          details: { code: error.code, status, message: error.message },
        };
      }
    },
  },
];
