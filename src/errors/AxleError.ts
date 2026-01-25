export class AxleError extends Error {
  public readonly code: string;
  public readonly id?: string;
  public readonly details?: Record<string, any>;

  constructor(
    message: string,
    options?: {
      code?: string;
      id?: string;
      details?: Record<string, any>;
      cause?: Error;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = this.constructor.name;
    this.code = options?.code || "AXLE_ERROR";
    this.id = options?.id;
    this.details = options?.details;

    Object.setPrototypeOf(this, AxleError.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      ...(this.id && { id: this.id }),
      ...(this.details && { details: this.details }),
      ...(this.cause && { cause: serializeError(this.cause) }),
    };
  }
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack && { stack: error.stack }),
      ...("cause" in error && error.cause && { cause: serializeError(error.cause) }),
    };
  }
  return error;
}
