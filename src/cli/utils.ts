import type { WorkflowStep } from "../actions/types.js";
import type { Recorder } from "../recorder/recorder.js";
import { FileRunPlanner } from "../workflows/planners/fileRunPlanner.js";
import { MultiPlanner } from "../workflows/planners/multiPlanner.js";
import { FileExistSkipCondition } from "../workflows/skipConditions/fileExistSkipCondition.js";
import type { BatchOptions, SkipOptions, Step, ToolProviderConfig } from "./configs/types.js";
import { converters } from "./converters/index.js";

export async function configToTasks(
  config: { steps: Step[]; tools?: string[]; toolConfig?: ToolProviderConfig },
  context: { recorder?: Recorder },
): Promise<WorkflowStep[]> {
  const { recorder } = context;
  const toolNames = config.tools ?? undefined;
  const toolConfig = config.toolConfig ?? undefined;
  const promises = config.steps.map(async (step) => {
    const converter = converters.get(step.uses);
    return await converter.convert(step, { recorder, toolNames, toolConfig });
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
