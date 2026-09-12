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

export function normalizeProviderError(error: unknown): {
  type: string;
  message: string;
  raw: unknown;
} {
  if (error instanceof Error) {
    return {
      type: error.name || "Error",
      message: error.message || "Unexpected error",
      raw: error,
    };
  }
  if (error && typeof error === "object") {
    const value = error as Record<string, any>;
    return {
      type: String(
        value.error?.error?.type ||
          value.error?.type ||
          value.type ||
          value.code ||
          value.status ||
          "Undetermined",
      ),
      message: String(
        value.error?.error?.message ||
          value.error?.message ||
          value.message ||
          value.error ||
          "Unexpected error",
      ),
      raw: error,
    };
  }
  return {
    type: "Undetermined",
    message: error == null ? "Unknown error occurred" : String(error),
    raw: error,
  };
}
