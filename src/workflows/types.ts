import type { WorkflowStep } from "../actions/types.js";
import type { AIProvider } from "../ai/types.js";
import type { AxleError } from "../errors/AxleError.js";
import type { TracingContext } from "../tracer/types.js";
import type { ProgramOptions, Stats } from "../types.js";
import type { Planner } from "./planners/types.js";

export interface Run {
  steps: WorkflowStep[];
  variables: Record<string, any>;
}

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

/* DAG types */
export interface DAGNodeDefinition {
  step: WorkflowStep | WorkflowStep[];
  dependsOn?: string | string[];
}

export interface DAGConcurrentNodeDefinition {
  planner: Planner;
  steps: WorkflowStep[];
  dependsOn?: string | string[];
}

export interface DAGDefinition {
  [nodeName: string]:
    | WorkflowStep
    | WorkflowStep[]
    | DAGNodeDefinition
    | DAGConcurrentNodeDefinition;
}

export interface DAGNode {
  id: string;
  steps: WorkflowStep[];
  dependencies: string[];
  planner?: Planner;
  executionType: "serial" | "concurrent";
}

export interface DAGExecutionPlan {
  stages: string[][];
  nodes: Map<string, DAGNode>;
}

export interface DAGWorkflowOptions {
  continueOnError?: boolean;
  maxConcurrency?: number;
}
