import { Recorder } from "../recorder/recorder.js";
import { FileRunPlanner } from "../workflows/planners/fileRunPlanner.js";
import { MultiPlanner } from "../workflows/planners/multiPlanner.js";
import { FileExistSkipCondition } from "../workflows/skipConditions/fileExistSkipCondition.js";
import { BatchOptions, SkipOptions, Step } from "./configs/schemas.js";
import { converters } from "./converters/index.js";

export async function configToTasks(
  config: { steps: Step[]; tools?: string[] },
  context: { recorder?: Recorder },
) {
  const { recorder } = context;
  const toolNames = config.tools ?? undefined;
  const promises = config.steps.map(async (step) => {
    const actionType = step.uses;
    const converter = converters.get(step.uses);
    return await converter.convert(step, { recorder, toolNames });
  });
  return Promise.all(promises);
}

export async function configToPlanner(
  config: { batch: BatchOptions[] },
  contexts: { recorder?: Recorder },
) {
  const { batch } = config;
  if (batch.length === 1) {
    return batchOptionsToPlanner(batch[0]);
  } else {
    return new MultiPlanner(batch.map((b) => batchOptionsToPlanner(b)));
  }
}

function batchOptionsToPlanner(b: BatchOptions) {
  switch (b.type) {
    case "files":
      let skipConditions = undefined;
      if (b["skip-if"]) {
        const skipOptions = b["skip-if"];
        skipConditions = skipOptions.map((o) => skipOptionsToSkipConditions(o));
      }
      return new FileRunPlanner(b.source, b.bind, skipConditions);
  }
}

function skipOptionsToSkipConditions(s: SkipOptions) {
  switch (s.type) {
    case "file-exist":
      return new FileExistSkipCondition(s.pattern);
  }
}
