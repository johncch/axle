import { AxleError } from "./AxleError.js";

export class TaskError extends AxleError {
  constructor(
    message: string,
    options?: {
      id?: string;
      taskType?: string;
      taskIndex?: number;
      details?: Record<string, any>;
      cause?: Error;
    },
  ) {
    super(message, {
      code: "TASK_ERROR",
      id: options?.id,
      details: {
        taskType: options?.taskType,
        taskIndex: options?.taskIndex,
        ...options?.details,
      },
      cause: options?.cause,
    });
    Object.setPrototypeOf(this, TaskError.prototype);
  }
}
