import { AxleError } from "./AxleError.js";

export class InstructVariableError extends AxleError {
  public readonly missingVariables: string[];

  constructor(missingVariables: string[]) {
    super(formatMissingVariablesMessage(missingVariables), {
      code: "INSTRUCT_VARIABLE_ERROR",
      details: { missingVariables },
    });
    this.missingVariables = missingVariables;

    Object.setPrototypeOf(this, InstructVariableError.prototype);
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
