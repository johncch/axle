export { DEFAULT_MODEL, Models } from "./models.js";
export { NAME, openai } from "./provider.js";

import { DEFAULT_MODEL, Models } from "./models.js";
export const OpenAI = { Models, DefaultModel: DEFAULT_MODEL } as const;
