import {
  estimateContextUsage,
  getCompactionStamp,
  PromptCompactor,
  type AIProvider,
  type AxleMessage,
} from "@fifthrevision/axle";
import { fail } from "./helpers.js";
import type { BaselineCase } from "./types.js";

const THRESHOLD_TOKENS = 12_000;
const SUMMARY_WORDS = 1_000;
const APPENDIX_TOKENS = 1_200;

function buildConversation(): AxleMessage[] {
  const messages: AxleMessage[] = [];
  for (let i = 0; i < 80; i++) {
    messages.push({
      role: "user",
      content:
        `Task ${i}: we are migrating service svc-${i} to the new gateway. ` +
        `The decision on ticket MIG-${100 + i} was to keep the legacy auth header ` +
        `until version 2.${i} ships. Constraint: the cutover for svc-${i} must not ` +
        `happen before the load test on cluster c-${i % 5} passes. ` +
        "Please record this and confirm the rollout order stays alphabetical.",
    });
    messages.push({
      role: "assistant",
      id: crypto.randomUUID(),
      content: [
        {
          type: "text",
          text:
            `Recorded. svc-${i} migrates after its c-${i % 5} load test, MIG-${100 + i} ` +
            `keeps the legacy auth header until 2.${i}, and the rollout order remains ` +
            "alphabetical. Nothing blocks the next service in the sequence.",
        },
      ],
    });
  }
  return messages;
}

function estimate(messages: AxleMessage[]): number {
  return estimateContextUsage({ messages }).messages;
}

export const compactionCases: BaselineCase[] = [
  {
    group: "extended",
    id: "compaction-size-ladder",
    description:
      "PromptCompactor shrinks an over-threshold conversation under the threshold with stamped messages.",
    async run({ provider, model }) {
      let summarizerCalls = 0;
      const countingProvider: AIProvider = {
        ...provider,
        createStreamingRequest(requestModel, params) {
          summarizerCalls += 1;
          return provider.createStreamingRequest(requestModel, params);
        },
      };

      const messages = buildConversation();
      const before = estimate(messages);
      const compactor = new PromptCompactor({
        provider: countingProvider,
        model,
        prompt:
          "You summarize an agent conversation so it can continue in a smaller context. " +
          "Preserve durable facts, decisions, constraints, file paths, tool outcomes, " +
          "completed work, and open tasks. Prefer concrete identifiers over prose.",
        thresholdTokens: THRESHOLD_TOKENS,
        summaryWords: SUMMARY_WORDS,
        appendixTokens: APPENDIX_TOKENS,
      });

      let result: Awaited<ReturnType<typeof compactor.compact>>;
      try {
        result = await compactor.compact(
          { messages },
          {
            usage: estimateContextUsage({ messages }),
            trigger: "manual",
            id: "check-1",
            emit: () => {},
          },
        );
      } catch (error) {
        return fail({ error, before });
      }

      const after = estimate(result.messages);
      const stamps = result.messages.map((message) => getCompactionStamp(message)?.role);
      const summaryText = String(result.messages[0]?.content);
      const summaryWordCount = (summaryText.match(/\S+/g) ?? []).length;

      const failureReasons = [
        ...(before > THRESHOLD_TOKENS
          ? []
          : [`Fixture is not over threshold (${before} <= ${THRESHOLD_TOKENS}).`]),
        ...(after < before ? [] : [`Did not shrink (${after} >= ${before}).`]),
        ...(after <= THRESHOLD_TOKENS
          ? []
          : [`Still over threshold (${after} > ${THRESHOLD_TOKENS}).`]),
        ...(stamps[0] === "summary" ? [] : ["First message is not a stamped summary."]),
        ...(stamps.some((role) => role === undefined) ? ["Unstamped compacted message."] : []),
      ];
      return {
        ok: failureReasons.length === 0,
        ...(failureReasons.length > 0 ? { failureReasons } : {}),
        details: {
          before,
          after,
          threshold: THRESHOLD_TOKENS,
          summaryWordCount,
          summaryWordsRequested: SUMMARY_WORDS,
          summaryOvershoot: summaryWordCount > Math.ceil(SUMMARY_WORDS * 1.3),
          summarizerCalls,
          stamps,
          summaryPreview: summaryText.slice(0, 300),
        },
      };
    },
  },
];
