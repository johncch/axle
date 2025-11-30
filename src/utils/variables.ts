import { Recorder } from "../recorder/recorder.js";

export function setResultsIntoVariables(
  results: Record<string, unknown>,
  variables: Record<string, unknown>,
  context: { options?: { warnUnused?: boolean }; recorder?: Recorder },
) {
  const { options, recorder } = context;
  const warnUnused = options?.warnUnused ?? true;

  for (const [key, value] of Object.entries(results)) {
    if (warnUnused && variables[key]) {
      recorder?.warn?.log(
        `Warning: Variable "${key}" is being overwritten. Previous value: ${variables[key]}, new value: ${value}`,
      );
    }
    variables[key] = value;
  }
}
