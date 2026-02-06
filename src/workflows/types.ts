import type { AIProvider } from "../ai/types.js";
import type { AxleError } from "../errors/AxleError.js";
import type { TracingContext } from "../tracer/types.js";
import type { ProgramOptions, Stats } from "../types.js";

export interface SerializedExecutionResponse {
  response: string;
  stats: Stats;
}

export interface ChatCommand {
  type: string;
}

export interface WorkflowResult<T = any> {
  response: T;
  stats?: Stats;
  error?: AxleError;
  success: boolean;
}

export interface WorkflowExecutable {
  execute: (context: {
    provider: AIProvider;
    variables: Record<string, any>;
    options?: ProgramOptions;
    stats?: Stats;
    tracer?: TracingContext;
    name?: string;
  }) => Promise<WorkflowResult>;
}
