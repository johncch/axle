import * as z from "zod";
import { Recorder } from "../recorder/recorder.js";
import { AbstractInstruct } from "./AbstractInstruct.js";
import { declarativeToOutputSchema, isOutputSchema } from "./typecheck.js";
import {
    DeclarativeSchema,
    InferedOutputSchema,
    OutputSchema,
} from "./types.js";

export class ChainOfThought<
  T extends OutputSchema,
> extends AbstractInstruct<T> {
  constructor(prompt: string, schema: T) {
    super(prompt, schema);
  }

  static with<T extends OutputSchema>(
    prompt: string,
    schema: T,
  ): ChainOfThought<T>;
  static with<T extends DeclarativeSchema>(
    prompt: string,
    schema: T,
  ): ChainOfThought<OutputSchema>;
  static with(prompt: string): ChainOfThought<{ response: z.ZodString }>;
  static with<T extends OutputSchema | DeclarativeSchema>(
    prompt: string,
    schema?: T,
  ): any {
    if (!schema) {
      return new ChainOfThought(prompt, { response: z.string() });
    }

    if (isOutputSchema(schema)) {
      return new ChainOfThought(prompt, schema);
    } else {
      const schemaRecord = declarativeToOutputSchema(schema);
      return new ChainOfThought(prompt, schemaRecord);
    }
  }

  override createInstructions(instructions: string = ""): string {
    const chainOfThoughtPrompt =
      "Let's think step by step. Use <thinking></thinking> tags to show your reasoning and thought process.\n\n";
    return super.createInstructions(chainOfThoughtPrompt);
  }

  override finalize(
    rawValue: string,
    runtime: { recorder?: Recorder } = {},
  ): InferedOutputSchema<T> & { thinking: string } {
    const results = super.finalize(rawValue, runtime);
    const taggedSections = this.parseTaggedSections(rawValue);

    let thinkTagName = "thinking";
    if (!("thinking" in taggedSections.tags)) {
      if ("think" in taggedSections.tags) {
        thinkTagName = "think";
        runtime.recorder?.warn?.log(
          "No <thinking> section found in the response but found <think> instead. This may be a limitation of the model or prompt.",
        );
      } else {
        runtime.recorder?.warn?.log(
          "No <thinking> section found in the response. Please ensure your response includes a <thinking> tag.",
        );
      }
    }

    return {
      ...results,
      thinking: taggedSections.tags[thinkTagName] || "",
    };
  }
}
