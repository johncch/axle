import type { AIProvider, AxleMessage } from "@fifthrevision/axle";
import { estimateContextUsage, getCompactionStamp, PromptCompactor } from "@fifthrevision/axle";
import "dotenv/config";
import { resolveProviderTargets, type BaselineProviderTarget } from "../baseline/providers.js";

/**
 * Live check for PromptCompactor's size ladder against real models: builds a
 * synthetic over-threshold conversation, compacts it, and verifies the result
 * shrank under the threshold with correctly stamped messages. Reports the
 * summary's word count against the request and how many summarizer calls ran
 * (1 = no rewrite pass).
 *
 *   pnpm tsx checks/compaction/run.ts                 # default provider set
 *   pnpm tsx checks/compaction/run.ts -p anthropic
 *   pnpm tsx checks/compaction/run.ts -p openrouter -m z-ai/glm-4.6
 *   pnpm tsx checks/compaction/run.ts --all
 */

const THRESHOLD_TOKENS = 12_000;
const SUMMARY_WORDS = 1_000;
const APPENDIX_TOKENS = 1_200;

interface RunOptions {
  providers: string[];
  model?: string;
  all: boolean;
}

function parseArgs(argv: string[]): RunOptions {
  const options: RunOptions = { providers: [], all: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-p" || arg === "--provider" || arg === "--providers") {
      while (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
        options.providers.push(argv[++i]);
      }
    } else if (arg === "-m" || arg === "--model") {
      options.model = argv[++i];
    } else if (arg === "--all") {
      options.all = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function buildConversation(): AxleMessage[] {
  const messages: AxleMessage[] = [];
  for (let i = 0; i < 40; i++) {
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

async function runTarget(target: BaselineProviderTarget): Promise<boolean> {
  let summarizerCalls = 0;
  const provider = target.createProvider();
  const countingProvider: AIProvider = {
    name: provider.name,
    createGenerationRequest: (model, params) => provider.createGenerationRequest(model, params),
    createStreamingRequest(model, params) {
      summarizerCalls += 1;
      return provider.createStreamingRequest(model, params);
    },
  };

  const messages = buildConversation();
  const before = estimate(messages);

  const compactor = new PromptCompactor({
    provider: countingProvider,
    model: target.model,
    prompt:
      "You summarize an agent conversation so it can continue in a smaller context. " +
      "Preserve durable facts, decisions, constraints, file paths, tool outcomes, " +
      "completed work, and open tasks. Prefer concrete identifiers over prose.",
    thresholdTokens: THRESHOLD_TOKENS,
    summaryWords: SUMMARY_WORDS,
    appendixTokens: APPENDIX_TOKENS,
  });

  console.log(`\n== ${target.id} · ${target.model} · reasoning unset (model default)`);
  console.log(
    `before: ~${before} tokens, threshold: ${THRESHOLD_TOKENS}, ` +
      `summary: ~${SUMMARY_WORDS} words, appendix: ${APPENDIX_TOKENS} tokens`,
  );
  process.stdout.write("compacting");

  const timer = setInterval(() => process.stdout.write("."), 1_000);
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
  } catch (e) {
    clearInterval(timer);
    console.log(`\nFAIL: compaction threw: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
  clearInterval(timer);

  const after = estimate(result.messages);
  const stamps = result.messages.map((message) => getCompactionStamp(message)?.role);
  const summaryText = String(result.messages[0]?.content);
  const summaryWordCount = (summaryText.match(/\S+/g) ?? []).length;

  console.log(`\nafter: ~${after} tokens (${Math.round((after / before) * 100)}% of before)`);
  console.log(`summary length: ${summaryWordCount} words (asked ~${SUMMARY_WORDS})`);
  console.log(`summarizer calls: ${summarizerCalls} (1 = no rewrite pass)`);
  console.log(`stamped roles: ${stamps.join(", ")}`);
  console.log(`summary preview: ${summaryText.slice(0, 300).replace(/\n/g, " ")}…`);

  const failures: string[] = [];
  if (after >= before) failures.push(`did not shrink (${after} >= ${before})`);
  if (after > THRESHOLD_TOKENS)
    failures.push(`still over threshold (${after} > ${THRESHOLD_TOKENS})`);
  if (stamps[0] !== "summary") failures.push("first message is not a stamped summary");
  if (stamps.some((role) => role === undefined)) failures.push("unstamped compacted message");

  if (failures.length > 0) {
    console.log(`FAIL: ${failures.join("; ")}`);
    return false;
  }
  if (summaryWordCount > Math.ceil(SUMMARY_WORDS * 1.3)) {
    console.log(`PASS (soft overshoot: ${summaryWordCount} words > 1.3× ${SUMMARY_WORDS})`);
  } else {
    console.log("PASS");
  }
  return true;
}

const options = parseArgs(process.argv.slice(2));
const targets = resolveProviderTargets(options);

let failed = 0;
for (const target of targets) {
  if (!(await runTarget(target))) failed += 1;
}

console.log(`\n${targets.length - failed}/${targets.length} targets passed`);
process.exit(failed > 0 ? 1 : 0);
