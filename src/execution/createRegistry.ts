import braveSearchTool from "../tools/brave.js";
import calculatorTool from "../tools/calculator.js";
import writeToDiskExecutable from "../executables/writeToDisk.js";
import { ExecutableRegistry } from "./ExecutableRegistry.js";

export function createExecutableRegistry(): ExecutableRegistry {
  const registry = new ExecutableRegistry();

  // Register built-in executables
  registry.register(writeToDiskExecutable);

  // Register tools as executables (they implement both interfaces)
  registry.register(braveSearchTool);
  registry.register(calculatorTool);

  return registry;
}
