import type { WorkflowStep } from "../actions/types.js";
import type { AIProvider } from "../ai/types.js";
import type { BatchJob } from "../cli/configs/schemas.js";
import { configToPlanner, configToTasks } from "../cli/utils.js";
import { AxleError } from "../errors/AxleError.js";
import type { TracingContext } from "../tracer/types.js";
import type { ProgramOptions, Stats } from "../types.js";
import { createErrorResult, createResult, isErrorResult } from "../utils/result.js";
import type { Planner } from "./planners/types.js";
import { serialWorkflow } from "./serial.js";
import type { Run, WorkflowExecutable, WorkflowResult } from "./types.js";

interface ConcurrentWorkflow {
  (jobConfig: BatchJob): WorkflowExecutable;
  (planner: Planner, ...steps: WorkflowStep[]): WorkflowExecutable;
}

/**
 * Type guard to check if the input is a BatchJob
 */
function isBatchJob(obj: BatchJob | Planner): obj is BatchJob {
  return "type" in obj && obj.type === "batch";
}

export const concurrentWorkflow: ConcurrentWorkflow = (
  first: BatchJob | Planner,
  ...rest: WorkflowStep[]
) => {
  const prepare = async (context: {
    tracer?: TracingContext;
  }): Promise<[Planner, WorkflowStep[]]> => {
    const { tracer } = context;

    if (isBatchJob(first)) {
      const planner = await configToPlanner(first, { tracer });
      const tasks = await configToTasks(first, { tracer });
      return [planner, tasks];
    } else {
      return [first, [...rest]];
    }
  };

  const execute = async (context: {
    provider: AIProvider;
    variables: Record<string, any>;
    options?: ProgramOptions;
    stats?: Stats;
    tracer?: TracingContext;
    name?: string;
  }): Promise<WorkflowResult> => {
    const { provider, variables, options, stats, tracer, name } = context;

    const concurrentSpan = tracer?.startSpan(name ?? "concurrent", { type: "workflow" });

    try {
      const [planner, steps] = await prepare({ tracer: concurrentSpan });
      const runs = await planner.plan(steps);
      concurrentSpan?.debug(JSON.stringify(runs, null, 2));

      if (runs.length === 0) {
        concurrentSpan?.info("No runs to execute");
        concurrentSpan?.end();
        return createResult([], stats);
      }

      concurrentSpan?.setAttribute("runs", runs.length);

      const executeRun = async (run: Run, index: number) => {
        const runSpan = concurrentSpan?.startSpan(`run-${index}`, { type: "internal" });
        try {
          const result = await serialWorkflow(...run.steps).execute({
            provider: provider,
            variables: { ...run.variables, ...variables },
            options,
            stats,
            tracer: runSpan,
            name: `${name}-${index}`,
          });
          runSpan?.end();
          return result;
        } catch (e) {
          const error =
            e instanceof AxleError
              ? e
              : new AxleError(`Error executing run`, {
                  cause: e instanceof Error ? e : new Error(String(e)),
                });
          runSpan?.end("error");
          concurrentSpan?.error(error.message);
          return createErrorResult(error, null, stats);
        }
      };

      const concurrentRuns = 5;
      let batchResults: WorkflowResult[] = [];

      for (let i = 0; i < runs.length; i += concurrentRuns) {
        const batch = runs.slice(i, i + concurrentRuns);
        const results = await Promise.all(batch.map(executeRun));
        batchResults = batchResults.concat(results);
      }

      const hasErrors = batchResults.some(isErrorResult);

      concurrentSpan?.end(hasErrors ? "error" : "ok");

      const response = batchResults.map((r) => r.response);
      return createResult(response, stats);
    } catch (error) {
      const axleError =
        error instanceof AxleError
          ? error
          : new AxleError(`Concurrent workflow execution failed`, {
              cause: error instanceof Error ? error : new Error(String(error)),
            });

      concurrentSpan?.error(axleError.message);
      concurrentSpan?.end("error");
      return createErrorResult(axleError, null, stats);
    }
  };

  return { execute };
};
