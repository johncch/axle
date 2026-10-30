import { AxleError, AxleErrorCode } from "../../../errors/AxleError.js";
import type { FileInfo } from "../../../utils/file.js";
import { resolveReasoning, type ReasoningSetting } from "../../reasoning.js";
import type { ChatCompletionsDialect } from "../dialect.js";

/**
 * Together toggles hybrid models with `reasoning.enabled` and steers GPT-OSS
 * and DeepSeek V4 with `reasoning_effort`; each model family reads the field
 * it knows, so an enabled request carries both.
 */
export function toTogetherReasoning(reasoning: ReasoningSetting | undefined) {
  const request = resolveReasoning(reasoning);
  if (request === "default") return {};
  if (request === "off") return { reasoning: { enabled: false } };
  return { reasoning: { enabled: true }, reasoning_effort: request.effort };
}

export function assertTogetherFilePartSupported(file: FileInfo): void {
  if (file.kind === "document") {
    throw new AxleError("Together Chat Completions does not support PDF file parts", {
      code: AxleErrorCode.PROVIDER_UNSUPPORTED,
      details: { protocol: "chatCompletions", feature: "document:application/pdf" },
    });
  }
}

export const togetherDialect: ChatCompletionsDialect = {
  reasoning: toTogetherReasoning,
  assertFileSupported: assertTogetherFilePartSupported,
};
