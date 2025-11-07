import { ModelError } from "./types.js";

export function getUndefinedError(e: unknown): ModelError {
  if (e == null) {
    return {
      type: "error",
      error: {
        type: "Undetermined",
        message: "Unknown error occurred",
      },
      usage: { in: 0, out: 0 },
      raw: e,
    };
  }

  // Handle standard Error objects
  if (e instanceof Error) {
    return {
      type: "error",
      error: {
        type: e.name || "Error",
        message: e.message || "Unexpected error",
      },
      usage: { in: 0, out: 0 },
      raw: e,
    };
  }

  // Handle object-based errors (common in AI SDKs)
  if (typeof e === "object") {
    const errorObj = e as any;

    // Try various common error structures
    const errorType =
      errorObj?.error?.error?.type || // Anthropic nested
      errorObj?.error?.type || // Common pattern
      errorObj?.type || // Direct property
      errorObj?.code || // OpenAI uses 'code'
      errorObj?.status || // HTTP status
      "Undetermined";

    const errorMessage =
      errorObj?.error?.error?.message || // Anthropic nested
      errorObj?.error?.message || // Common pattern
      errorObj?.message || // Direct property
      errorObj?.error || // Error as string
      "Unexpected error";

    return {
      type: "error",
      error: {
        type: String(errorType),
        message: String(errorMessage),
      },
      usage: { in: 0, out: 0 },
      raw: e,
    };
  }

  // Handle primitive values (string, number, etc.)
  return {
    type: "error",
    error: {
      type: "Undetermined",
      message: String(e),
    },
    usage: { in: 0, out: 0 },
    raw: e,
  };
}
