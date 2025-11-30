import type { WorkflowStep } from "../../actions/types.js";
import type { Run } from "../types.js";
import type { Planner } from "./types.js";

export class MultiPlanner implements Planner {
  planners: Planner[];
  constructor(planners: Planner[]) {
    this.planners = planners;
  }

  async plan(steps: WorkflowStep[]): Promise<Run[]> {
    const promises = this.planners.map(async (p) => {
      return await p.plan(steps);
    });
    const allRuns = await Promise.all(promises);
    return allRuns.flat();
  }
}
