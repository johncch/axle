import type { WorkflowStep } from "../actions/types.js";
import type { AIProvider } from "../ai/types.js";
import type { BatchJob } from "../cli/configs/types.js";
import { configToPlanner, configToTasks } from "../cli/utils.js";
import { AxleError } from "../errors/AxleError.js";
import type { Recorder } from "../recorder/recorder.js";
import { TaskStatus } from "../recorder/types.js";
import type { ProgramOptions, Stats } from "../types.js";
import { createErrorResult, createResult, isErrorResult } from "../utils/result.js";
import { friendly } from "../utils/utils.js";
import type { Planner } from "./planners/types.js";
import { serialWorkflow } from "./serial.js";
import type { Run, WorkflowExecutable, WorkflowResult } from "./types.js";

interface ConcurrentWorkflow {
  (jobConfig: BatchJob): WorkflowExecutable;
  (planner: Planner, ...steps: WorkflowStep[]): WorkflowExecutable;
}

export const concurrentWorkflow: ConcurrentWorkflow = (
  first: BatchJob | Planner,
  ...rest: WorkflowStep[]
) => {
  const prepare = async (context: { recorder?: Recorder }): Promise<[Planner, WorkflowStep[]]> => {
    const { recorder } = context;
    let steps: WorkflowStep[] = [];
    let planner: Planner = null;
    if ("batch" in first) {
      const jobConfig = first as BatchJob;
      planner = await configToPlanner(jobConfig, { recorder });
      steps = await configToTasks(jobConfig, { recorder });
    } else {
      planner = first as Planner;
      steps = [...rest];
    }
    return [planner, steps];
  };

  const execute = async (context: {
    provider: AIProvider;
    variables: Record<string, any>;
    options?: ProgramOptions;
    stats?: Stats;
    recorder?: Recorder;
    name?: string;
  }): Promise<WorkflowResult> => {
    const { provider, variables, options, stats, recorder, name } = context;

    const id = crypto.randomUUID();

    try {
      const [planner, steps] = await prepare({ recorder });
      const runs = await planner.plan(steps);
      recorder?.debug?.heading.log("Runs", runs);

      if (runs.length === 0) {
        recorder?.info?.log("No runs to execute");
        return createResult([], stats);
      }

      let completed = 0;
      recorder?.info?.log({
        type: "task",
        status: TaskStatus.Running,
        id,
        message: `[${friendly(id, "CRW")}] Working on 0/${runs.length}`,
      });

      const executeRun = async (run: Run, index: number) => {
        try {
          const result = await serialWorkflow(...run.steps).execute({
            provider: provider,
            variables: { ...run.variables, ...variables },
            options,
            stats,
            recorder,
            name: `${name}-${index}`,
          });
          return result;
        } catch (e) {
          const error =
            e instanceof AxleError
              ? e
              : new AxleError(`Error executing run`, {
                  cause: e instanceof Error ? e : new Error(String(e)),
                });
          recorder?.error?.log(error);
          return createErrorResult(error, null, stats);
        } finally {
          completed++;
          recorder?.info?.log({
            type: "task",
            status: TaskStatus.Running,
            id,
            message: `[${friendly(id, "CRW")}] Working on ${completed}/${runs.length}`,
          });
        }
      };

      const concurrentRuns = 5;
      let batchResults: WorkflowResult[] = [];

      for (let i = 0; i < runs.length; i += concurrentRuns) {
        const batch = runs.slice(i, i + concurrentRuns);
        const results = await Promise.all(batch.map(executeRun));
        batchResults = batchResults.concat(results);
      }

      // Check if any run had errors but continue execution
      const hasErrors = batchResults.some(isErrorResult);

      recorder?.info?.log({
        type: "task",
        status: hasErrors ? TaskStatus.PartialSuccess : TaskStatus.Success,
        id,
        message: `[${friendly(id, "CRW")}] All jobs (${runs.length}) completed${hasErrors ? " with some errors" : ""}`,
      });

      // Process all results, including those with errors
      const response = batchResults.map((r) => r.response);
      return createResult(response, stats);
    } catch (error) {
      const axleError =
        error instanceof AxleError
          ? error
          : new AxleError(`Concurrent workflow execution failed`, {
              id: id,
              cause: error instanceof Error ? error : new Error(String(error)),
            });

      recorder?.error?.log(axleError);
      return createErrorResult(axleError, null, stats);
    }
  };

  return { execute };
};
