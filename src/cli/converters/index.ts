import { createExecutableRegistry } from "../../execution/createRegistry.js";
import { chatConverter } from "./chat.js";
import { StepToClassRegistry } from "./converters.js";
import { writeToDiskConverter } from "./writeToDisk.js";

// Create singleton executable registry for CLI
const executableRegistry = createExecutableRegistry();

export const converters = new StepToClassRegistry();
converters.register("write-to-disk", writeToDiskConverter);
converters.register("chat", chatConverter);

export { executableRegistry };
