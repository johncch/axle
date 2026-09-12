import { cacheCases } from "./cache.js";
import { compactionCases } from "./compaction.js";
import { coreCases } from "./core.js";
import { geminiCitationCases } from "./gemini-citations.js";
import { instructJsonCases } from "./instruct-json.js";
import { messageFormatCases } from "./message-format.js";
import { reasoningCases } from "./reasoning.js";
import { streamErrorCases } from "./stream-errors.js";
import { toolSchemaCases } from "./tool-schema.js";

export type * from "./types.js";

export const checkCases = [
  ...coreCases,
  ...streamErrorCases,
  ...toolSchemaCases,
  ...instructJsonCases,
  ...messageFormatCases,
  ...geminiCitationCases,
  ...reasoningCases,
  ...cacheCases,
  ...compactionCases,
];
