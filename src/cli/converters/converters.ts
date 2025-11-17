import type { WorkflowStep } from "../../actions/types.js";
import type { Recorder } from "../../recorder/recorder.js";
import type { Step } from "../configs/schemas.js";

type StepBase = Extract<Step, { uses: string }>;

export interface StepToClassConverter<S extends StepBase, T extends WorkflowStep> {
  convert(s: S, context?: { recorder?: Recorder; [key: string]: any }): Promise<T>;
}

export class StepToClassRegistry<S extends StepBase, T extends WorkflowStep> {
  converters: Map<string, StepToClassConverter<S, T>> = new Map();

  get(name: string): StepToClassConverter<S, T> {
    const converter = this.converters.get(name);
    if (!converter) {
      throw new Error(`No converter registered for step: ${name}`);
    }
    return converter;
  }

  register(name: string, converter: StepToClassConverter<S, T>) {
    this.converters.set(name, converter);
  }
}
