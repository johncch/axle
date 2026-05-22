import "dotenv/config";
import { anthropic, generate } from "../../src/index.js";
import { AnthropicModels } from "../../src/providers/models.js";
import type { Stats } from "../../src/types.js";
import { env, print, requiredEnv } from "./runtime.js";

const apiKey = requiredEnv("ANTHROPIC_API_KEY");
const model = env.ANTHROPIC_CACHE_MODEL ?? AnthropicModels.CLAUDE_HAIKU_4_5;
const provider = anthropic(apiKey);
const prompt = [
  stableContext("anthropic"),
  "",
  "Answer with exactly this text: cache telemetry ok",
].join("\n");

const first = await run("first");
const second = await run("second");

print("anthropic", { model, first, second });

if ((first.cacheWriteIn ?? 0) <= 0) {
  throw new Error(
    `Expected first Anthropic call to report cacheWriteIn > 0. Usage: ${JSON.stringify(first)}`,
  );
}
if ((second.cachedIn ?? 0) <= 0) {
  throw new Error(
    `Expected second Anthropic call to report cachedIn > 0. Usage: ${JSON.stringify(second)}`,
  );
}

async function run(label: string): Promise<Stats> {
  const result = await generate({
    provider,
    model,
    messages: [{ role: "user", content: prompt }],
    maxOutputTokens: 24,
    providerOptions: {
      cache_control: { type: "ephemeral" },
    },
  });

  if (!result.ok) {
    throw new Error(`${label} call failed: ${JSON.stringify(result.error)}`);
  }
  return result.usage ?? { in: 0, out: 0 };
}

function stableContext(providerName: string): string {
  return Array.from(
    { length: 1800 },
    (_, index) =>
      `Stable ${providerName} cache line ${index}: Axle should preserve cache creation and cache read token telemetry for repeated long prompts.`,
  ).join("\n");
}
