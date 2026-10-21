import { AxleAbortError } from "./AxleAbortError.js";
import { AxleAgentAbortError } from "./AxleAgentAbortError.js";
import { AxleError, AxleErrorCode } from "./AxleError.js";
import { AxleInstructVariableError } from "./AxleInstructVariableError.js";
import { AxleToolFatalError } from "./AxleToolFatalError.js";

export type AnyAxleError =
  AxleAgentAbortError | AxleAbortError | AxleToolFatalError | AxleInstructVariableError | AxleError;

/**
 * True for an Error carrying an `AxleErrorCode`, whichever copy of the
 * package built it. See docs/architecture/errors.md.
 */
export function isAxleError(error: unknown): error is AnyAxleError {
  if (!(error instanceof Error) || !("code" in error)) return false;
  return Object.values(AxleErrorCode).some((code) => code === error.code);
}
