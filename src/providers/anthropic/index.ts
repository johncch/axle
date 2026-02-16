export { DEFAULT_MODEL, Models } from "./models.js";
export { anthropic, NAME } from "./provider.js";

import { DEFAULT_MODEL, Models } from "./models.js";
export const Anthropic = { Models, DefaultModel: DEFAULT_MODEL } as const;
