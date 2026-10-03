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
  status?: number;
  raw: unknown;
} {
  if (error instanceof Error) {
    const status = httpStatusOf(error);
    const message = error.message || "Unexpected error";
    return {
      type: isRejectedCredential(status, message) ? "authentication" : error.name || "Error",
      message,
      ...(status === undefined ? {} : { status }),
      raw: error,
    };
  }
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    const nested = value.error as Record<string, unknown> | undefined;
    const innerNested = nested?.error as Record<string, unknown> | undefined;
    const status = httpStatusOf(value);
    const message = String(
      innerNested?.message ||
        nested?.message ||
        value.message ||
        (typeof value.error === "string" ? value.error : undefined) ||
        "Unexpected error",
    );
    const type = String(
      innerNested?.type || nested?.type || value.type || value.code || status || "Undetermined",
    );
    return {
      type: isRejectedCredential(status, message) ? "authentication" : type,
      message,
      ...(status === undefined ? {} : { status }),
      raw: error,
    };
  }
  return {
    type: "Undetermined",
    message: error == null ? "Unknown error occurred" : String(error),
    raw: error,
  };
}

function httpStatusOf(value: object): number | undefined {
  const status = (value as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function isRejectedCredential(status: number | undefined, message: string): boolean {
  if (status === 401) return true;
  return status === 400 && message.includes("API_KEY_INVALID");
}
