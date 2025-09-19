import * as z from "zod";
import { AbstractInstruct } from "./AbstractInstruct.js";
import { declarativeToOutputSchema, isOutputSchema } from "./typecheck.js";
import { DeclarativeSchema, OutputSchema } from "./types.js";

export class Instruct<T extends OutputSchema> extends AbstractInstruct<T> {
  constructor(prompt: string, schema: T) {
    super(prompt, schema);
  }

  static with<T extends OutputSchema>(prompt: string, schema: T): Instruct<T>;
  static with<T extends DeclarativeSchema>(
    prompt: string,
    schema: T,
  ): Instruct<OutputSchema>;
  static with(prompt: string): Instruct<{ response: z.ZodString }>;
  static with<T extends OutputSchema | DeclarativeSchema>(
    prompt: string,
    schema?: T,
  ): any {
    if (!schema) {
      return new Instruct(prompt, { response: z.string() });
    }

    if (isOutputSchema(schema)) {
      return new Instruct(prompt, schema);
    } else {
      const schemaRecord = declarativeToOutputSchema(schema);
      return new Instruct(prompt, schemaRecord);
    }
  }
}
