import writeToDiskExecutable from "../../executables/writeToDisk.js";
import {
  WriteOutputTask,
  WriteToDiskTask,
} from "../../tasks/writeToDisk/task.js";
import { arrayify } from "../../utils/utils.js";
import { WriteToDiskStep } from "../configs/types.js";
import { StepToClassConverter } from "./converters.js";

export const writeToDiskConverter: StepToClassConverter<
  WriteToDiskStep,
  WriteToDiskTask
> = {
  async convert(step: WriteToDiskStep): Promise<WriteToDiskTask> {
    const task = step.keys
      ? new WriteOutputTask(step.output, arrayify(step.keys))
      : new WriteOutputTask(step.output);

    // Attach the executable to the task
    task._executable = writeToDiskExecutable;

    return task;
  },
};
