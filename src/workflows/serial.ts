import { AIProvider } from "../ai/types.js";
import { SerialJob } from "../cli/configs/types.js";
import { configToTasks } from "../cli/utils.js";
import { Instruct } from "../core/Instruct.js";
import { AxleError } from "../errors/AxleError.js";
import { TaskError } from "../errors/TaskError.js";
import { ExecutableExecutor } from "../execution/ExecutableExecutor.js";
import { LLMExecutor } from "../execution/LLMExecutor.js";
import { Conversation } from "../messages/conversation.js";
import { Recorder } from "../recorder/recorder.js";
import { TaskStatus } from "../recorder/types.js";
import {
  ExecutableTask,
  ProgramOptions,
  Stats,
  Task,
  TaskResult,
} from "../types.js";
import { createErrorResult, createResult } from "../utils/result.js";
import { friendly } from "../utils/utils.js";
import { Keys } from "../utils/variables.js";
import { WorkflowExecutable, WorkflowResult } from "./types.js";

interface SerialWorkflow {
  (jobConfig: SerialJob): WorkflowExecutable;
  (...instructions: Task[]): WorkflowExecutable;
}

export const serialWorkflow: SerialWorkflow = (first: SerialJob | Task, ...rest: Task[]) => {
  const prepare = async (context: { recorder?: Recorder }) => {
    const { recorder } = context;
    let tasks: Task[] = [];
    if ("steps" in first) {
      const jobConfig = first as SerialJob;
      tasks = await configToTasks(jobConfig, { recorder });
    } else {
      tasks = [first as Task, ...rest];
    }
    return tasks;
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

    // Create executors
    const llmExecutor = new LLMExecutor();
    const executableExecutor = new ExecutableExecutor();

    recorder?.info?.log({
      type: "task",
      id,
      status: TaskStatus.Running,
      message: `[${friendly(id, name)}] Starting job`,
    });

    try {
      const tasks = await prepare({ recorder });
      const conversation = new Conversation();

      for (const [index, task] of tasks.entries()) {
        recorder?.info?.log({
          type: "task",
          id,
          status: TaskStatus.Running,
          message: `[${friendly(id, name)}] Processing step ${index + 1}: ${task.type}`,
        });

        try {
          let result: TaskResult;

          if (task.type === "instruct") {
            // LLM execution path
            result = await llmExecutor.execute(task as Instruct<any>, {
              conversation,
              provider,
              stats,
              variables,
              recorder,
            });
          } else {
            // Executable execution path
            const executableTask = task as ExecutableTask;

            // Extract parameters from task (excluding the 'type' and '_executable' fields)
            const { type, _executable, ...params } = executableTask as any;

            result = await executableExecutor.execute(_executable, params, {
              variables,
              options,
              recorder,
            });
          }

          // Merge outputs into variables
          Object.assign(variables, result.outputs);
        } catch (error) {
          const taskError =
            error instanceof AxleError
              ? error
              : new TaskError(`Error executing task ${task.type}`, {
                  id: id,
                  taskType: task.type,
                  taskIndex: index,
                  cause:
                    error instanceof Error ? error : new Error(String(error)),
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
