import { describe, expect, expectTypeOf, test, vi } from "vitest";
import {
  choice,
  decide,
  noul,
  score,
  type ChoiceAnswer,
  type DecisionAnswer,
  type DecisionProvider,
  type DecisionRefusal,
  type DecisionRequestParams,
  type NoulAnswer,
  type ScoreAnswer,
} from "../../src/providers/decide.js";

interface RecordedRequest {
  model: string;
  params: DecisionRequestParams;
}

function fakeProvider(answers: Record<string, DecisionAnswer>): {
  provider: DecisionProvider;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  return {
    requests,
    provider: {
      name: "Fake",
      async createDecisionRequest(model, params) {
        requests.push({ model, params });
        return { model: `${model}-snapshot`, answers, usage: { in: 12, out: 3 } };
      },
    },
  };
}

const questions = {
  is_bug: noul("Is the customer reporting a defect?"),
  team: choice("Which team owns this?", { payments: "Billing issues", frontend: null }),
  urgency: score("How urgent?", ["Can wait", "This week", "Blocking"]),
};

const scoreAnswer: ScoreAnswer = {
  type: "score",
  score: 1.99,
  probabilities: { "0": 0, "1": 0.01, "2": 0.99 },
  legend: { "0": "Can wait", "1": "This week", "2": "Blocking" },
  confidence: 0.99,
};

const answers: Record<string, DecisionAnswer> = {
  is_bug: { type: "noul", noul: 0.96 },
  team: {
    type: "choice",
    choice: "payments",
    probabilities: { payments: 0.78, frontend: 0.22 },
    confidence: 0.67,
  },
  urgency: scoreAnswer,
};

describe("decide", () => {
  test("sends the input and questions to the provider and returns its answers", async () => {
    const { provider, requests } = fakeProvider(answers);

    const result = await decide({
      provider,
      model: "jev-latest",
      input: { ticket: "Checkout shows a blank screen" },
      questions,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].model).toBe("jev-latest");
    expect(requests[0].params.input).toEqual({ ticket: "Checkout shows a blank screen" });
    expect(requests[0].params.questions).toEqual({
      is_bug: { type: "noul", instructions: "Is the customer reporting a defect?" },
      team: {
        type: "choice",
        instructions: "Which team owns this?",
        criteria: { payments: "Billing issues", frontend: null },
      },
      urgency: {
        type: "score",
        instructions: "How urgent?",
        criteria: ["Can wait", "This week", "Blocking"],
      },
    });
    expect(result).toEqual({
      model: "jev-latest-snapshot",
      answers,
      usage: { in: 12, out: 3 },
    });
  });

  test("types each answer from its question", async () => {
    const result = await decide({
      provider: fakeProvider(answers).provider,
      model: "jev-latest",
      input: "text",
      questions,
    });

    expectTypeOf(result.answers.is_bug).toEqualTypeOf<NoulAnswer | DecisionRefusal>();
    expectTypeOf(result.answers.team).toEqualTypeOf<
      ChoiceAnswer<"payments" | "frontend"> | DecisionRefusal
    >();
    expectTypeOf(result.answers.urgency).toEqualTypeOf<ScoreAnswer | DecisionRefusal>();
  });

  test("passes a refusal through alongside the answered questions", async () => {
    const result = await decide({
      provider: fakeProvider({ ...answers, urgency: { type: "refusal" } }).provider,
      model: "gpt-6-luna",
      input: "text",
      questions,
    });

    expect(result.answers.urgency).toEqual({ type: "refusal" });
    expect(result.answers.is_bug).toEqual({ type: "noul", noul: 0.96 });
  });

  test("rejects a response that leaves a question unanswered", async () => {
    const { provider } = fakeProvider({ is_bug: answers.is_bug, team: answers.team });

    await expect(
      decide({ provider, model: "jev-latest", input: "text", questions }),
    ).rejects.toMatchObject({
      code: "DECISION_ANSWER_MISMATCH",
      message: 'Fake returned no answer for score question "urgency"',
    });
  });

  test("rejects an answer of a different type than its question", async () => {
    const { provider } = fakeProvider({ ...answers, is_bug: scoreAnswer });

    await expect(
      decide({ provider, model: "jev-latest", input: "text", questions }),
    ).rejects.toMatchObject({
      code: "DECISION_ANSWER_MISMATCH",
      message: 'Fake returned score for noul question "is_bug"',
    });
  });

  test("forwards the abort signal and rethrows provider failures", async () => {
    const controller = new AbortController();
    const failure = new Error("boom");
    const createDecisionRequest = vi
      .fn<DecisionProvider["createDecisionRequest"]>()
      .mockRejectedValue(failure);

    await expect(
      decide({
        provider: { name: "Fake", createDecisionRequest },
        model: "jev-latest",
        input: "text",
        questions,
        signal: controller.signal,
      }),
    ).rejects.toBe(failure);
    expect(createDecisionRequest.mock.calls[0][1].signal).toBe(controller.signal);
  });
});
