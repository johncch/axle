import { cacheCases } from "./cache.js";
import { codeExecutionCases } from "./code-execution.js";
import { compactionCases } from "./compaction.js";
import { continuationCases } from "./continuation.js";
import { coreCases } from "./core.js";
import { decideCases } from "./decide.js";
import { deferredToolCases } from "./deferred-tools.js";
import { geminiCitationCases } from "./gemini-citations.js";
import { instructJsonCases } from "./instruct-json.js";
import { messageFormatCases } from "./message-format.js";
import { reasoningCases } from "./reasoning.js";
import { remoteAgentCases } from "./remote-agent.js";
import { streamErrorCases } from "./stream-errors.js";
import { toolSchemaCases } from "./tool-schema.js";
import type { AnyCheckCase } from "./types.js";

export type * from "./types.js";

export const checkCases: AnyCheckCase[] = [
  ...coreCases,
  ...continuationCases,
  ...deferredToolCases,
  ...remoteAgentCases,
  ...streamErrorCases,
  ...codeExecutionCases,
  ...toolSchemaCases,
  ...instructJsonCases,
  ...messageFormatCases,
  ...geminiCitationCases,
  ...reasoningCases,
  ...cacheCases,
  ...compactionCases,
  ...decideCases,
];
