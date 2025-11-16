import writeToDiskExecutable from "../executables/writeToDisk.js";
import { ExecutableRegistry } from "./ExecutableRegistry.js";

export function createExecutableRegistry(): ExecutableRegistry {
  const registry = new ExecutableRegistry();

  // Register built-in executables
  registry.register(writeToDiskExecutable);

  return registry;
}
