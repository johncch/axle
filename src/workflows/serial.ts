import { AIProvider } from "../ai/types.js";
import { SerialJob } from "../cli/configs/schemas.js";
import { configToTasks } from "../cli/utils.js";
import { AxleError } from "../errors/AxleError.js";
import { TaskError } from "../errors/TaskError.js";
import { Conversation } from "../messages/conversation.js";
import { Recorder } from "../recorder/recorder.js";
import { TaskStatus } from "../recorder/types.js";
import { createNodeRegistry } from "../registry/nodeRegistryFactory.js";
import { ProgramOptions, Stats, Task } from "../types.js";
import { createErrorResult, createResult } from "../utils/result.js";
import { friendly } from "../utils/utils.js";
import { Keys } from "../utils/variables.js";
import { WorkflowExecutable, WorkflowResult } from "./types.js";

interface SerialWorkflow {
  (jobConfig: SerialJob): WorkflowExecutable;
  (...instructions: Task[]): WorkflowExecutable;
}

/**
 * Type guard to check if the input is a SerialJob
 */
function isSerialJob(obj: SerialJob | Task): obj is SerialJob {
  return "steps" in obj && "type" in obj && obj.type === "serial";
}

export const serialWorkflow: SerialWorkflow = (first: SerialJob | Task, ...rest: Task[]) => {
  const prepare = async (context: { recorder?: Recorder }) => {
    const { recorder } = context;

    if (isSerialJob(first)) {
      return await configToTasks(first, { recorder });
    } else {
      return [first, ...rest];
    }
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
    const actionRegistry = createNodeRegistry();

    recorder?.info?.log({
      type: "task",
      id,
      status: TaskStatus.Running,
      message: `[${friendly(id, name)}] Starting job`,
    });

    try {
      const tasks = await prepare({ recorder });
      const chat = new Conversation();

      for (const [index, task] of tasks.entries()) {
        recorder?.info?.log({
          type: "task",
          id,
          status: TaskStatus.Running,
          message: `[${friendly(id, name)}] Processing step ${index + 1}: ${task.type}`,
        });

        try {
          await actionRegistry.executeTask({
            task,
            chat,
            provider,
            variables,
            options,
            stats,
            recorder,
          });
        } catch (error) {
          const taskError =
            error instanceof AxleError
              ? error
              : new TaskError(`Error executing task ${task.type}`, {
                  id: id,
                  taskType: task.type,
                  taskIndex: index,
                  cause: error instanceof Error ? error : new Error(String(error)),
                });
          throw taskError;
        }
      }

      recorder?.info?.log({
        type: "task",
        status: TaskStatus.Success,
        id,
        message: `[${friendly(id, name)}] Completed ${tasks.length} steps`,
      });

      return createResult(variables[Keys.LastResult], stats);
    } catch (error) {
      const axleError =
        error instanceof AxleError
          ? error
          : new AxleError(`Serial workflow execution failed`, {
              id: id,
              cause: error instanceof Error ? error : new Error(String(error)),
            });

      recorder?.info?.log({
        type: "task",
        status: TaskStatus.Fail,
        id,
        message: `[${friendly(id, name)}] Failed: ${axleError.message}`,
      });
      recorder?.error.log(axleError);

      return createErrorResult(axleError, variables[Keys.LastResult], stats);
    }
  };

  return { execute };
};
