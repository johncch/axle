export { DEFAULT_MODEL, Models } from "./models.js";
export { gemini, NAME } from "./provider.js";

import { DEFAULT_MODEL, Models } from "./models.js";
export const Gemini = { Models, DefaultModel: DEFAULT_MODEL } as const;
