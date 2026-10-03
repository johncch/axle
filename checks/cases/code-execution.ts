import {
  generate,
  stream,
  type ContentPartProviderTool,
  type ProviderTool,
} from "@fifthrevision/axle";
import { fail, getAssistantText } from "./helpers.js";
import type { CheckCase, CheckCaseContext } from "./types.js";

function codeExecutionTool(providerId: CheckCaseContext["providerId"]): ProviderTool {
  if (providerId === "openai") {
    return { type: "provider", name: "code_execution", config: { container: { type: "auto" } } };
  }
  return { type: "provider", name: "code_execution" };
}

function readStdout(part: ContentPartProviderTool): string | undefined {
  const output = part.result?.type === "success" ? part.result.output : undefined;
  return typeof output === "string" ? output : output?.stdout;
}

export const codeExecutionCases: CheckCase[] = [
  {
    group: "extended",
    id: "stream-code-execution-round-trip",
    description:
      "Code execution is stored as a provider-tool part with the provider's objects and the stdout, fires provider-tool events, and a follow-up that depends on the output is accepted.",
    providers: ["openai", "anthropic", "google"],
    async run({ provider, model, providerId, requestOptions }) {
      const providerTools = [codeExecutionTool(providerId)];
      const events: string[] = [];
      const handle = stream({
        provider,
        model,
        ...requestOptions,
        providerTools,
        messages: [
          {
            role: "user",
            content:
              "Use code execution to compute the sum of the first 50 prime numbers. Print the result and then tell me the answer in one sentence.",
          },
        ],
      });
      handle.on((event) => {
        if (event.type.startsWith("provider-tool:")) events.push(event.type);
      });
      const first = await handle.final;
      if (!first.ok) return fail({ error: first.error });

      const part = first.final.content.find(
        (item): item is ContentPartProviderTool =>
          item.type === "provider-tool" &&
          (item.name === "code_execution" || item.name === "bash_code_execution"),
      );
      const output = part ? readStdout(part) : undefined;
      const failureReasons: string[] = [];
      if (!part) failureReasons.push("No provider-tool part was stored.");
      if (part && part.input?.type !== "code" && part.input?.type !== "command") {
        failureReasons.push("Input is neither the code nor the command shape.");
      }
      if (part?.result?.type !== "success") failureReasons.push("Result is not success.");
      if (!part?.continuity) failureReasons.push("No continuity was stored.");
      if (part?.continuity?.provider === "gemini" && part.continuity.parts.length !== 2) {
        failureReasons.push(`Continuity holds ${part.continuity.parts.length} parts, not 2.`);
      }
      if (!output?.includes("5117")) failureReasons.push("The stdout does not hold the sum.");
      for (const type of ["provider-tool:start", "provider-tool:input", "provider-tool:complete"]) {
        if (!events.includes(type)) failureReasons.push(`${type} did not fire.`);
      }
      if (failureReasons.length > 0) {
        return { ok: false, failureReasons, details: { events, content: first.final.content } };
      }

      const followUp = await generate({
        provider,
        model,
        ...requestOptions,
        providerTools,
        messages: [
          ...first.messages,
          {
            role: "user",
            content: "Without running code again, divide that sum by 7 and give me the remainder.",
          },
        ],
      });
      if (!followUp.ok) return fail({ error: followUp.error });
      const text = getAssistantText(followUp.final);
      const answered = /\b0\b|zero/i.test(text);
      return {
        ok: answered,
        failureReasons: answered ? undefined : ["Follow-up did not answer 0."],
        details: { events, output, text, usage: followUp.usage },
      };
    },
  },
];
