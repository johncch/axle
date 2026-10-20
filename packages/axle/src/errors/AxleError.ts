export const AxleErrorCode = {
  INVALID_OPTIONS: "INVALID_OPTIONS",
  PROVIDER_UNSUPPORTED: "PROVIDER_UNSUPPORTED",
  FILE_UNREADABLE: "FILE_UNREADABLE",
  TOOL_REGISTRY_DUPLICATE: "TOOL_REGISTRY_DUPLICATE",
  SKILL_REGISTRY_DUPLICATE: "SKILL_REGISTRY_DUPLICATE",
  SKILL_INVALID: "SKILL_INVALID",
  SKILL_NOT_FOUND: "SKILL_NOT_FOUND",
  INSTRUCT_VARIABLE_ERROR: "INSTRUCT_VARIABLE_ERROR",
  COMPACTION_INVALID_MESSAGES: "COMPACTION_INVALID_MESSAGES",
  COMPACTION_GENERATION_FAILED: "COMPACTION_GENERATION_FAILED",
  COMPACTION_EMPTY_SUMMARY: "COMPACTION_EMPTY_SUMMARY",
  DECISION_REQUEST_FAILED: "DECISION_REQUEST_FAILED",
  DECISION_RESPONSE_INVALID: "DECISION_RESPONSE_INVALID",
  DECISION_ANSWER_MISMATCH: "DECISION_ANSWER_MISMATCH",
  AGENT_DEFINITION_INVALID: "AGENT_DEFINITION_INVALID",
  MCP_NOT_CONNECTED: "MCP_NOT_CONNECTED",
  TOOL_FATAL_ERROR: "TOOL_FATAL_ERROR",
  ABORTED: "ABORTED",
  AXLE_ERROR: "AXLE_ERROR",
} as const;

export type AxleErrorCode = (typeof AxleErrorCode)[keyof typeof AxleErrorCode];

/**
 * Thrown for everything that is not the provider's answer to a request that
 * went out: bad options, unsupported features, unreadable files, broken
 * invariants, and the interruptions (`ABORTED`, `TOOL_FATAL_ERROR`). `code`
 * identifies the error; a subclass exists only where the error carries a
 * payload. See docs/architecture/errors.md.
 */
export class AxleError extends Error {
  public readonly code: AxleErrorCode;
  public readonly id?: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    options?: {
      code?: AxleErrorCode;
      id?: string;
      details?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = this.constructor.name;
    this.code = options?.code ?? AxleErrorCode.AXLE_ERROR;
    this.id = options?.id;
    this.details = options?.details;

    Object.setPrototypeOf(this, AxleError.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      ...(this.id ? { id: this.id } : {}),
      ...(this.details ? { details: this.details } : {}),
      ...(this.cause ? { cause: serializeError(this.cause) } : {}),
    };
  }
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
      ...("cause" in error && error.cause ? { cause: serializeError(error.cause) } : {}),
    };
  }
  return error;
}
