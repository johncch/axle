import type { TracingContext } from "../tracer/types.js";

export function setResultsIntoVariables(
  results: Record<string, unknown>,
  variables: Record<string, unknown>,
  context: { options?: { warnUnused?: boolean }; tracer?: TracingContext },
) {
  const { options, tracer } = context;
  const warnUnused = options?.warnUnused ?? true;

  for (const [key, value] of Object.entries(results)) {
    if (warnUnused && variables[key]) {
      tracer?.warn(
        `Warning: Variable "${key}" is being overwritten. Previous value: ${variables[key]}, new value: ${value}`,
      );
    }
    variables[key] = value;
  }
}
