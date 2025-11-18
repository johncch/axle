import { Recorder } from "../../recorder/recorder.js";
import { Task } from "../../types.js";
import { Step } from "../configs/schemas.js";

type StepBase = Extract<Step, { uses: string }>;

export interface StepToClassConverter<S extends StepBase, T extends Task> {
  convert(
    s: S,
    context?: { recorder?: Recorder; [key: string]: any },
  ): Promise<T>;
}

export class StepToClassRegistry<S extends StepBase, T extends Task> {
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
