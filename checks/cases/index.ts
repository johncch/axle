import { cacheCases } from "./cache.js";
import { compactionCases } from "./compaction.js";
import { coreCases } from "./core.js";
import { instructJsonCases } from "./instruct-json.js";
import { messageFormatCases } from "./message-format.js";
import { reasoningCases } from "./reasoning.js";
import { toolSchemaCases } from "./tool-schema.js";

export type * from "./types.js";

export const checkCases = [
  ...coreCases,
  ...toolSchemaCases,
  ...instructJsonCases,
  ...messageFormatCases,
  ...reasoningCases,
  ...cacheCases,
  ...compactionCases,
];
