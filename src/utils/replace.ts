export interface ReplaceVariablesOptions {
  placeholderStyle?: "{}" | "{{}}";
  strict?: boolean;
}

export function replaceVariables(
  input: string,
  variables: Record<string, any>,
  options: ReplaceVariablesOptions = {},
): string {
  const { placeholderStyle = "{{}}", strict = true } = options;
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
    if (strict) {
      throw new Error(`Missing variable${unique.length > 1 ? "s" : ""}: ${unique.join(", ")}`);
    }
  }
  return input;
}
