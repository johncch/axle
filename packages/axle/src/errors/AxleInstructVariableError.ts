import { AxleError, AxleErrorCode } from "./AxleError.js";

export class AxleInstructVariableError extends AxleError {
  public override readonly code = AxleErrorCode.INSTRUCT_VARIABLE_ERROR;
  public readonly missingVariables: string[];

  constructor(missingVariables: string[]) {
    super(formatMissingVariablesMessage(missingVariables), {
      code: AxleErrorCode.INSTRUCT_VARIABLE_ERROR,
      details: { missingVariables },
    });
    this.missingVariables = missingVariables;

    Object.setPrototypeOf(this, AxleInstructVariableError.prototype);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      missingVariables: this.missingVariables,
    };
  }
}

function formatMissingVariablesMessage(missingVariables: string[]): string {
  return `Missing variable${missingVariables.length > 1 ? "s" : ""}: ${missingVariables.join(", ")}`;
}
