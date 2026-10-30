import z from "zod";
import { AxleError, AxleErrorCode } from "../errors/AxleError.js";
import type { AnyStreamChunk } from "../messages/stream.js";
import type { Span } from "../observability/types.js";
import type { ToolDefinition } from "../tools/types.js";

export function requireInteger(
  value: number,
  name: string,
  options: { min?: number } = {},
): number {
  if (!Number.isInteger(value)) {
    throw new AxleError(`${name} must be an integer`, { code: AxleErrorCode.INVALID_OPTIONS });
  }

  if (options.min !== undefined && value < options.min) {
    throw new AxleError(`${name} must be an integer greater than or equal to ${options.min}`, {
      code: AxleErrorCode.INVALID_OPTIONS,
    });
  }

  return value;
}

export function toolJsonSchema(tool: ToolDefinition): z.core.JSONSchema.BaseSchema {
  try {
    return z.toJSONSchema(tool.schema);
  } catch (error) {
    throw new AxleError(
      `Tool ${tool.name} has a schema that cannot be expressed as JSON Schema: ${error instanceof Error ? error.message : String(error)}`,
      { code: AxleErrorCode.INVALID_OPTIONS, details: { name: tool.name }, cause: error },
    );
  }
}

/**
 * Runs the wire call of a provider adapter. What `call` throws is what the
 * provider or transport did, and becomes an `error` chunk; everything before
 * the call runs outside this wrapper and rejects. See
 * docs/architecture/errors.md, invariant 8.
 */
export async function* wireCall(
  span: Span | undefined,
  signal: AbortSignal | undefined,
  call: () => AsyncGenerator<AnyStreamChunk, void, unknown>,
): AsyncGenerator<AnyStreamChunk, void, unknown> {
  try {
    yield* call();
  } catch (error) {
    if (signal?.aborted) return;
    span?.error(error instanceof Error ? error.message : String(error));
    yield { type: "error", data: normalizeProviderError(error) };
  }
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

export function lookupHost<T>(table: Readonly<Record<string, T>>, baseUrl: string): T | undefined {
  try {
    return table[new URL(baseUrl).hostname.toLowerCase()];
  } catch {
    return undefined;
  }
}
