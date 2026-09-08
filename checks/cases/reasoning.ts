import {
  generate,
  stream,
  type AxleAssistantMessage,
  type AxleMessage,
  type ExecutableTool,
  type ReasoningEffort,
  type ReasoningSetting,
} from "@fifthrevision/axle";
import * as z from "zod";
import type { ProviderId } from "../providers.js";
import { fail, getAssistantText } from "./helpers.js";
import type { CheckCase, CheckCaseResult } from "./types.js";

// Trivial prompts often produce no visible reasoning; a small puzzle makes
// every provider emit thinking content.
const reasoningPrompt =
  "How many times does the letter r appear in the phrase 'strawberry raspberry'? Work it out, then answer with only the number.";

const EFFORTS: ReasoningEffort[] = ["low", "medium", "high"];

// Models whose request syntax differs from the provider's default check
// target, so both routes run in a single default pass.
const LEGACY_BUDGET_MODELS: Partial<Record<ProviderId, string>> = {
  anthropic: "claude-haiku-4-5",
  gemini: "gemini-2.5-flash-lite",
};
const MODERN_EFFORT_MODELS: Partial<Record<ProviderId, string>> = {
  anthropic: "claude-sonnet-4-6",
  gemini: "gemini-flash-lite-latest",
};

// Combinations the provider documents as invalid; Axle sends them unchanged
// and expects the provider error to surface.
const UNSUPPORTED_SETTINGS: Partial<
  Record<ProviderId, { model: string; reasoning: ReasoningSetting }>
> = {
  anthropic: { model: "claude-fable-5-1", reasoning: "off" },
  gemini: { model: "gemini-3.1-pro-preview", reasoning: "off" },
};

export const reasoningCases: CheckCase[] = [
  {
    group: "default",
    id: "reasoning-off",
    description: "generate() succeeds with reasoning explicitly disabled.",
    exclusions: [
      { provider: "anthropic", model: /fable/, reason: "Fable rejects thinking.type: disabled." },
      {
        provider: "gemini",
        model: /gemini-3|-latest$/,
        reason: "Gemini 3 cannot disable thinking; the -latest aliases resolve to Gemini 3.",
      },
    ],
    async run({ provider, model, requestOptions }) {
      const result = await generate({
        provider,
        model,
        ...requestOptions,
        messages: [{ role: "user", content: "Reply with exactly: pong" }],
        reasoning: "off",
      });

      if (!result.ok) return fail({ error: result.error });
      const text = getAssistantText(result.final);
      return {
        ok: text.toLowerCase().includes("pong"),
        details: { text, usage: result.usage },
      };
    },
  },
  {
    group: "default",
    id: "reasoning-efforts",
    description: "generate() accepts each named effort on the target model.",
    async run({ provider, model, requestOptions }) {
      const perEffort: Record<string, unknown> = {};
      const failureReasons: string[] = [];
      let usage: unknown;

      for (const effort of EFFORTS) {
        const result = await generate({
          provider,
          model,
          ...requestOptions,
          messages: [{ role: "user", content: reasoningPrompt }],
          reasoning: { effort },
        });
        if (!result.ok) {
          failureReasons.push(`effort ${effort}: ${result.error.message}`);
          perEffort[effort] = { error: result.error };
          continue;
        }
        usage = result.usage;
        perEffort[effort] = {
          text: getAssistantText(result.final),
          reasoningOut: result.usage?.reasoningOut,
          thinkingParts: countThinking(result.final),
        };
      }

      return {
        ok: failureReasons.length === 0,
        ...(failureReasons.length > 0 ? { failureReasons } : {}),
        details: { perEffort, usage },
      };
    },
  },
  {
    group: "default",
    id: "reasoning-stream-effort",
    description: "stream() with an explicit effort completes and reports reasoning.",
    async run({ provider, model, requestOptions }) {
      const handle = stream({
        provider,
        model,
        ...requestOptions,
        messages: [{ role: "user", content: reasoningPrompt }],
        reasoning: { effort: "low" },
      });
      let thinkingDeltaCount = 0;
      handle.on((event) => {
        if (event.type === "thinking:delta") thinkingDeltaCount += 1;
      });

      const result = await handle.final;
      if (!result.ok) return fail({ error: result.error });
      const text = getAssistantText(result.final);
      return {
        ok: text.includes("6"),
        details: {
          text,
          thinkingDeltaCount,
          thinkingParts: countThinking(result.final),
          usage: result.usage,
        },
      };
    },
  },
  {
    group: "default",
    id: "reasoning-tool-continuity",
    description:
      "A reasoning-enabled tool loop passes thinking continuity back through the tool turn and finishes.",
    async run({ provider, model, providerId, requestOptions }) {
      const result = await generate({
        provider,
        model,
        ...requestOptions,
        reasoning: "on",
        ...(providerId === "openai"
          ? { providerOptions: { store: false, include: ["reasoning.encrypted_content"] } }
          : {}),
        messages: [
          {
            role: "user",
            content: "Use the add_numbers tool to add 17 and 25. Then answer with the result.",
          },
        ],
        tools: [addNumbersTool],
      });

      if (!result.ok) return fail({ error: result.error });
      const text = getAssistantText(result.final);
      const toolTurns = result.messages.filter(
        (message): message is AxleAssistantMessage =>
          message.role === "assistant" && message.content.some((part) => part.type === "tool-call"),
      );
      return {
        ok: text.includes("42") && toolTurns.length > 0,
        details: {
          text,
          toolTurns: toolTurns.length,
          thinkingBeforeToolCall: toolTurns.map(countThinking),
          messageCount: result.messages.length,
          usage: result.usage,
        },
      };
    },
  },
  {
    group: "extended",
    id: "reasoning-route-legacy",
    description: "Legacy budget models accept the token-budget preset and spend reasoning tokens.",
    providers: ["anthropic", "gemini"],
    async run({ provider, providerId, requestOptions }) {
      const model = LEGACY_BUDGET_MODELS[providerId]!;
      const result = await generate({
        provider,
        model,
        ...requestOptions,
        messages: [{ role: "user", content: reasoningPrompt }],
        reasoning: { effort: "low" },
      });

      if (!result.ok) return fail({ model, error: result.error });
      const reasoningOut = result.usage?.reasoningOut ?? 0;
      const thinkingParts = countThinking(result.final);
      const reasoned = reasoningOut > 0 || thinkingParts > 0;
      return {
        ok: reasoned,
        ...(reasoned
          ? {}
          : { failureReasons: ["No reasoning tokens or thinking part was reported."] }),
        details: {
          model,
          text: getAssistantText(result.final),
          reasoningOut,
          thinkingParts,
          usage: result.usage,
        },
      };
    },
  },
  {
    group: "extended",
    id: "reasoning-route-modern",
    description: "Modern models accept named effort on the adaptive or level-based route.",
    providers: ["anthropic", "gemini"],
    async run({ provider, providerId, requestOptions }) {
      const model = MODERN_EFFORT_MODELS[providerId]!;
      const result = await generate({
        provider,
        model,
        ...requestOptions,
        messages: [{ role: "user", content: reasoningPrompt }],
        reasoning: { effort: "high" },
      });

      if (!result.ok) return fail({ model, error: result.error });
      return {
        ok: true,
        details: {
          model,
          text: getAssistantText(result.final),
          reasoningOut: result.usage?.reasoningOut,
          usage: result.usage,
        },
      };
    },
  },
  {
    group: "extended",
    id: "reasoning-unsupported-error",
    description: "An explicit setting the model cannot honor surfaces as a provider error.",
    providers: ["anthropic", "gemini"],
    async run({ provider, providerId }): Promise<CheckCaseResult> {
      const { model, reasoning } = UNSUPPORTED_SETTINGS[providerId]!;
      const result = await generate({
        provider,
        model,
        messages: [{ role: "user", content: "Reply with exactly: pong" }],
        reasoning,
      });

      if (result.ok) {
        return {
          ok: false,
          failureReasons: ["The provider accepted a setting it documents as unsupported."],
          details: { model, reasoning, text: getAssistantText(result.final), usage: result.usage },
        };
      }
      return { ok: true, details: { model, reasoning, error: result.error } };
    },
  },
];

const addNumbersTool: ExecutableTool<z.ZodObject<{ a: z.ZodNumber; b: z.ZodNumber }>> = {
  name: "add_numbers",
  description: "Add two numbers and return their sum.",
  schema: z.object({ a: z.number(), b: z.number() }),
  async execute(input) {
    return String(input.a + input.b);
  },
};

function countThinking(message: AxleMessage | undefined): number {
  if (!message || message.role !== "assistant") return 0;
  return message.content.filter((part) => part.type === "thinking").length;
}
