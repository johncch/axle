import { AxleError } from "../errors/AxleError.js";
import type { Span } from "../observability/types.js";
import type { Stats } from "../types.js";

export type DecisionJson =
  string | number | boolean | null | DecisionJson[] | { [key: string]: DecisionJson };

export type DecisionInput = string | DecisionJson[] | { [key: string]: DecisionJson };

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
}

export interface ChoiceQuestion<TOption extends string = string> {
  type: "choice";
  instructions: string;
  criteria: Record<TOption, string | null>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
}

export type DecisionQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export interface ChoiceAnswer<TOption extends string = string> {
  type: "choice";
  choice: TOption;
  probabilities: Record<TOption, number>;
  confidence: number;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  probabilities: Record<string, number>;
  legend: Record<string, string>;
  confidence: number;
}

export interface DecisionRefusal {
  type: "refusal";
}

export type DecisionAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer | DecisionRefusal;

export type AnswerFor<TQuestion extends DecisionQuestion> = TQuestion extends NoulQuestion
  ? NoulAnswer | DecisionRefusal
  : TQuestion extends ChoiceQuestion<infer TOption>
    ? ChoiceAnswer<TOption> | DecisionRefusal
    : TQuestion extends ScoreQuestion
      ? ScoreAnswer | DecisionRefusal
      : never;

export type DecisionQuestions = Record<string, DecisionQuestion>;

export type DecisionAnswers<TQuestions extends DecisionQuestions> = {
  [TKey in keyof TQuestions]: AnswerFor<TQuestions[TKey]>;
};

export interface DecisionRequestParams {
  input: DecisionInput;
  questions: DecisionQuestions;
  signal?: AbortSignal;
  span?: Span;
}

export interface DecisionResponse {
  /** The model that served the request, as the provider reported it. */
  model: string;
  answers: Record<string, DecisionAnswer>;
  usage: Stats;
}

/**
 * A provider that answers typed questions about an input instead of
 * generating text.
 *
 * @experimental
 */
export interface DecisionProvider {
  get name(): string;

  /** @internal */
  createDecisionRequest(model: string, params: DecisionRequestParams): Promise<DecisionResponse>;
}

export interface DecideParams<TQuestions extends DecisionQuestions> {
  provider: DecisionProvider;
  model: string;
  /** The content every question is asked about. */
  input: DecisionInput;
  /** Questions keyed by a name of your choosing; answers come back under the same keys. */
  questions: TQuestions;
  signal?: AbortSignal;
  span?: Span;
}

export interface DecideResult<TQuestions extends DecisionQuestions> {
  model: string;
  answers: DecisionAnswers<TQuestions>;
  usage: Stats;
}

/** A yes/no question. The answer is the probability of yes. */
export function noul(
  instructions: string,
  criteria?: { true: string; false: string },
): NoulQuestion {
  return { type: "noul", instructions, ...(criteria ? { criteria } : {}) };
}

/** Picks one option. `criteria` maps each option to its description, or null. */
export function choice<const TOption extends string>(
  instructions: string,
  criteria: Record<TOption, string | null>,
): ChoiceQuestion<TOption> {
  return { type: "choice", instructions, criteria };
}

/** Rates the input on an ordered scale. `criteria` lists the levels, lowest first. */
export function score(instructions: string, criteria: string[]): ScoreQuestion {
  return { type: "score", instructions, criteria };
}

/**
 * Asks a decision model typed questions about one input. One request, one
 * answer per question, no conversation.
 *
 * @experimental The question, answer, and provider shapes may change in a
 * minor release.
 */
export async function decide<const TQuestions extends DecisionQuestions>(
  options: DecideParams<TQuestions>,
): Promise<DecideResult<TQuestions>>;
export async function decide(
  options: DecideParams<DecisionQuestions>,
): Promise<DecideResult<DecisionQuestions>> {
  const { provider, model, input, questions, signal, span } = options;
  const decideSpan = span?.startSpan("decide", {
    type: "llm",
    attributes: { provider: provider.name, model, questions: Object.keys(questions).length },
  });

  try {
    const response = await provider.createDecisionRequest(model, {
      input,
      questions,
      signal,
      span: decideSpan,
    });

    for (const [key, question] of Object.entries(questions)) {
      const answerType = response.answers[key]?.type;
      if (answerType !== question.type && answerType !== "refusal") {
        throw new AxleError(
          `${provider.name} returned ${answerType ?? "no answer"} for ${question.type} question "${key}"`,
          { code: "DECISION_ANSWER_MISMATCH", details: { key, expected: question.type } },
        );
      }
    }

    decideSpan?.setAttributes({
      model: response.model,
      inputTokens: response.usage.in,
      outputTokens: response.usage.out,
    });
    decideSpan?.end("ok");
    return { model: response.model, answers: response.answers, usage: response.usage };
  } catch (error) {
    decideSpan?.end(signal?.aborted ? "cancelled" : "error");
    throw error;
  }
}
