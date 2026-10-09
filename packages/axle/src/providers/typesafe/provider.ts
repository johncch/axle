import * as z from "zod";
import { AxleError } from "../../errors/AxleError.js";
import { withRetry } from "../chatcompletions/retry.js";
import type { DecisionProvider, DecisionRequestParams, DecisionResponse } from "../decide.js";
import type { ProviderClientOptions } from "../types.js";

export const NAME = "TypeSafe" as const;

const DEFAULT_BASE_URL = "https://api.typesafe.ai";

export interface TypesafeOptions extends ProviderClientOptions {
  /**
   * API root that serves `/v1/systemone`. Point it at a compatible host to
   * route through it, e.g. `https://openrouter.ai/api` with an OpenRouter key.
   */
  baseUrl?: string;
}

const systemOneResponseSchema = z.object({
  model: z.string(),
  answers: z.record(
    z.string(),
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("noul"), noul: z.number() }),
      z.object({
        type: z.literal("choice"),
        choice: z.string(),
        probabilities: z.record(z.string(), z.number()),
        confidence: z.number(),
      }),
      z.object({
        type: z.literal("score"),
        score: z.number(),
        probabilities: z.record(z.string(), z.number()),
        legend: z.record(z.string(), z.string()),
        confidence: z.number(),
      }),
    ]),
  ),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

/**
 * TypeSafe's System One API (Jev). A decision provider only: it answers
 * `decide()` questions and cannot generate text.
 *
 * @experimental
 */
export function typesafe(apiKey: string, options: TypesafeOptions = {}): DecisionProvider {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");

  return {
    name: NAME,

    /** @internal */
    async createDecisionRequest(
      model: string,
      params: DecisionRequestParams,
    ): Promise<DecisionResponse> {
      const response = await withRetry(
        ({ signal }) =>
          fetch(`${baseUrl}/v1/systemone`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
              ...options.headers,
            },
            body: JSON.stringify({ model, state: params.input, questions: params.questions }),
            signal,
          }),
        {
          maxRetries: options.maxRetries,
          timeoutMs: options.timeoutMs,
          signal: params.signal,
          onRetry: (info) =>
            params.span?.warn("TypeSafe decision request retry", {
              attempt: info.attempt,
              delayMs: info.delayMs,
              status: info.status,
            }),
        },
      );

      const text = await response.text();
      if (!response.ok) {
        throw new AxleError(`TypeSafe request failed with status ${response.status}: ${text}`, {
          code: "DECISION_REQUEST_FAILED",
          details: { status: response.status, body: text },
        });
      }

      const parsed = systemOneResponseSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        throw new AxleError("TypeSafe returned a response Axle could not read", {
          code: "DECISION_RESPONSE_INVALID",
          details: { body: text },
          cause: parsed.error,
        });
      }

      return {
        model: parsed.data.model,
        answers: parsed.data.answers,
        usage: { in: parsed.data.usage.input_tokens, out: parsed.data.usage.output_tokens },
      };
    },
  };
}
