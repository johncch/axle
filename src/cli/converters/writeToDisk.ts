import {
  WriteOutputTask,
  WriteToDiskTask,
} from "../../tasks/writeToDisk/task.js";
import { arrayify } from "../../utils/utils.js";
import { WriteToDiskStep } from "../configs/schemas.js";
import { StepToClassConverter } from "./converters.js";

export const writeToDiskConverter: StepToClassConverter<
  WriteToDiskStep,
  WriteToDiskTask
> = {
  async convert(step: WriteToDiskStep): Promise<WriteToDiskTask> {
    if (step.keys) {
      const keys = arrayify(step.keys);
      return new WriteOutputTask(step.output, keys);
    }
    return new WriteOutputTask(step.output);
  },
};
