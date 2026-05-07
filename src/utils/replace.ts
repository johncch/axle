export interface ReplaceVariablesOptions {
  placeholderStyle?: "{}" | "{{}}";
}

export function replaceVariables(
  input: string,
  variables: Record<string, any>,
  options: ReplaceVariablesOptions = {},
): string {
  const { placeholderStyle = "{{}}" } = options;
  const pattern = placeholderStyle === "{{}}" ? /\{\{(.*?)\}\}/g : /\{(.*?)\}/g;
  const missing: string[] = [];
  input = input.replace(pattern, (match, group) => {
    group = group.trim();
    if (Object.prototype.hasOwnProperty.call(variables, group)) {
      const value = variables[group];
      return value === undefined || value === null ? "" : String(value);
    }
    missing.push(group);
    return match;
  });
  if (missing.length > 0) {
    const unique = [...new Set(missing)];
    throw new Error(
      `Missing variable${unique.length > 1 ? "s" : ""}: ${unique.join(", ")}. Pass them as --args key=value.`,
    );
  }
  return input;
}
