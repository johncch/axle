import { cacheCases } from "./cache.js";
import { compactionCases } from "./compaction.js";
import { coreCases } from "./core.js";
import { instructJsonCases } from "./instruct-json.js";
import { messageFormatCases } from "./message-format.js";
import { toolSchemaCases } from "./tool-schema.js";

export type * from "./types.js";

export const baselineCases = [
  ...coreCases,
  ...toolSchemaCases,
  ...instructJsonCases,
  ...messageFormatCases,
  ...cacheCases,
  ...compactionCases,
];
