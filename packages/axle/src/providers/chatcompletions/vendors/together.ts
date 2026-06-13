import type { FileInfo } from "../../../utils/file.js";

export function toTogetherReasoning(reasoning: boolean | undefined) {
  if (reasoning === true) return { reasoning: { enabled: true } };
  if (reasoning === false) return { reasoning: { enabled: false } };
  return {};
}

export function assertTogetherFilePartSupported(file: FileInfo): void {
  if (file.kind === "document") {
    throw new Error("Together Chat Completions does not support PDF file parts");
  }
}
