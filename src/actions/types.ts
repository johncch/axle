import type { Instruct } from "../core/Instruct.js";
import type { Recorder } from "../recorder/recorder.js";
import type { ProgramOptions } from "../types.js";

export interface ActionContext {
  input: string;
  variables: Record<string, any>;
  options?: ProgramOptions;
  recorder?: Recorder;
}

export interface Action {
  name: string;
  execute(context: ActionContext): Promise<string | void>;
}

export type WorkflowStep = Instruct<any> | Action;
