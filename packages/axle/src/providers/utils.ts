export function requireInteger(
  value: number,
  name: string,
  options: { min?: number } = {},
): number {
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }

  if (options.min !== undefined && value < options.min) {
    throw new Error(`${name} must be an integer greater than or equal to ${options.min}`);
  }

  return value;
}
