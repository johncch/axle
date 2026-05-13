import * as z from "zod";
import type { FileInfo } from "../utils/file.js";
import { replaceVariables } from "../utils/replace.js";
import type { OutputSchema } from "./parse.js";
import { zodToExample } from "./parse.js";

export type InstructInputs = Record<string, unknown>;
export type InstructVarsMode = "required" | "optional";

export interface InstructOptions {
  vars?: InstructVarsMode;
}

export class Instruct<TSchema extends OutputSchema | undefined = undefined> {
  prompt: string;
  inputs: InstructInputs = {};
  files: FileInfo[] = [];
  textReferences: Array<{ content: string; name?: string }> = [];
  vars: InstructVarsMode;

  schema: TSchema;

  constructor(prompt: string, schema?: TSchema, options: InstructOptions = {}) {
    this.prompt = prompt;
    this.schema = schema as TSchema;
    this.vars = options.vars ?? "required";
  }

  clone(): Instruct<TSchema> {
    const instruct = new Instruct(this.prompt, this.schema, {
      vars: this.vars,
    });
    instruct.inputs = { ...this.inputs };
    instruct.files = [...this.files];
    instruct.textReferences = this.textReferences.map((reference) => ({ ...reference }));
    return instruct;
  }

  withInputs(inputs: InstructInputs): Instruct<TSchema> {
    const instruct = this.clone();
    instruct.inputs = { ...instruct.inputs, ...inputs };
    return instruct;
  }

  withInput(name: string, value: unknown): Instruct<TSchema> {
    return this.withInputs({ [name]: value });
  }

  setInputs(inputs: InstructInputs) {
    this.inputs = { ...inputs };
  }

  addInput(name: string, value: unknown) {
    this.inputs[name] = value;
  }

  addFile(file: FileInfo | string, options?: { name?: string }) {
    if (typeof file === "string") {
      this.textReferences.push({ content: file, name: options?.name });
      return;
    }
    if (file.kind === "text" && file.source.type === "text") {
      this.textReferences.push({ content: file.source.content, name: options?.name ?? file.name });
      return;
    }
    this.files.push(options?.name ? { ...file, name: options.name } : file);
  }

  hasFiles(): boolean {
    return this.files.length > 0;
  }

  render(options: { vars?: InstructVarsMode } = {}): string {
    let message = replaceVariables(this.prompt, this.inputs, {
      strict: (options.vars ?? this.vars) === "required",
    });

    if (this.textReferences.length > 0) {
      for (const [index, ref] of this.textReferences.entries()) {
        const referenceTitle = ref.name ? `: ${ref.name}` : "";
        message += `\n\n## Reference ${index + 1}${referenceTitle}\n\n\`\`\`${ref.content}'''`;
      }
    }

    const schemaKeys = this.schema ? Object.keys(this.schema) : [];
    if (schemaKeys.length === 0) return message;

    let instructions =
      "# Output Format Instructions\n\nReturn only a valid JSON object matching this schema. Do not wrap it in markdown. Do not include prose before or after the JSON.\n";
    const exampleObject: Record<string, unknown> = {};
    for (const [key, fieldSchema] of Object.entries(this.schema!)) {
      const [value, example] = zodToExample(fieldSchema as z.ZodTypeAny);
      exampleObject[key] = example;
      instructions += `\n- ${key}: ${value}`;
    }
    instructions += `\n\nExample:\n${JSON.stringify(exampleObject, null, 2)}\n\n`;

    return instructions + message;
  }
}
