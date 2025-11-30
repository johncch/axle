import type { WorkflowStep } from "../../actions/types.js";
import type { Run } from "../types.js";

export interface Planner {
  plan(steps: WorkflowStep[]): Promise<Run[]>;
}
