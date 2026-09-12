import {
  AxleAbortError,
  AxleStopReason,
  generate,
  stream,
  type AIProvider,
} from "@fifthrevision/axle";
import type { CheckCase } from "./types.js";

export const streamErrorCases: CheckCase[] = [
  {
    id: "stream-error-contract",
    group: "default",
    description:
      "Injected provider failures preserve diagnostics and usage through both public APIs.",
    async run() {
      const raw = { code: "rate_limit_error", requestId: "fault-fixture" };
      const provider: AIProvider = {
        name: "fault-fixture",
        async *createStreamingRequest() {
          yield {
            type: "error",
            data: { type: "rate_limit_error", message: "slow down", usage: { in: 7, out: 2 }, raw },
          };
        },
      };
      for (const api of [
        generate,
        (options: Parameters<typeof generate>[0]) => stream(options).final,
      ]) {
        const result = await api({ provider, model: "fixture", messages: [] });
        if (
          result.ok ||
          result.error.kind !== "model" ||
          result.error.error.raw !== raw ||
          result.error.error.error.type !== "rate_limit_error" ||
          result.error.message !== "slow down" ||
          result.usage?.in !== 7 ||
          result.usage.out !== 2
        ) {
          return { ok: false, details: { result } };
        }
      }
      return { ok: true };
    },
  },
  {
    id: "stream-escaped-abort",
    group: "default",
    description: "Escaped provider AbortError preserves completed messages and usage.",
    async run() {
      for (const api of [
        generate,
        (options: Parameters<typeof generate>[0]) => stream(options).final,
      ]) {
        let step = 0;
        const provider: AIProvider = {
          name: "fault-fixture",
          async *createStreamingRequest() {
            if (step++ > 0) throw Object.assign(new Error("aborted"), { name: "AbortError" });
            yield { type: "start", id: "step-1", data: { model: "fixture", timestamp: 0 } };
            yield { type: "tool-call-start", data: { index: 0, id: "call-1", name: "lookup" } };
            yield {
              type: "tool-call-complete",
              data: { index: 0, id: "call-1", name: "lookup", arguments: {} },
            };
            yield {
              type: "complete",
              data: { finishReason: AxleStopReason.FunctionCall, usage: { in: 11, out: 3 } },
            };
          },
        };
        try {
          await api({
            provider,
            model: "fixture",
            messages: [],
            onToolCall: async () => ({ type: "success", content: "done" }),
          });
          return { ok: false, failureReasons: ["Expected AxleAbortError"] };
        } catch (error) {
          if (
            !(error instanceof AxleAbortError) ||
            error.messages?.length !== 2 ||
            error.usage?.in !== 11 ||
            error.usage.out !== 3
          ) {
            return { ok: false, details: { error } };
          }
        }
      }
      return { ok: true };
    },
  },
];
