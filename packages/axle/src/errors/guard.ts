import { AxleAbortError } from "./AxleAbortError.js";
import { AxleAgentAbortError } from "./AxleAgentAbortError.js";
import { AxleError } from "./AxleError.js";
import { AxleInstructVariableError } from "./AxleInstructVariableError.js";
import { AxleToolFatalError } from "./AxleToolFatalError.js";

export type AnyAxleError =
  AxleAgentAbortError | AxleAbortError | AxleToolFatalError | AxleInstructVariableError | AxleError;

export function isAxleError(error: unknown): error is AnyAxleError {
  return error instanceof AxleError;
}
