import * as z from "zod";
import type { FileInfo } from "../utils/file.js";
import { replaceVariables } from "../utils/replace.js";
import type { OutputSchema } from "./parse.js";
import { zodToExample } from "./parse.js";

export type InstructInputs = Record<string, unknown>;

export class Instruct<TSchema extends OutputSchema | undefined = undefined> {
  prompt: string;
  inputs: InstructInputs = {};
  files: FileInfo[] = [];
  textReferences: Array<{ content: string; name?: string }> = [];

  schema: TSchema;

  constructor(prompt: string, schema?: TSchema) {
    this.prompt = prompt;
    this.schema = schema as TSchema;
  }

  clone(): Instruct<TSchema> {
    const instruct = new Instruct(this.prompt, this.schema);
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

  render(): string {
    let message = replaceVariables(this.prompt, this.inputs);

    if (this.textReferences.length > 0) {
      for (const [index, ref] of this.textReferences.entries()) {
        const referenceTitle = ref.name ? `: ${ref.name}` : "";
        message += `\n\n## Reference ${index + 1}${referenceTitle}\n\n\`\`\`${ref.content}'''`;
      }
    }

    const schemaKeys = this.schema ? Object.keys(this.schema) : [];
    if (schemaKeys.length === 0) return message;

    let instructions =
      "# Output Format Instructions\n\nHere is how you should format your output. Follow the instructions strictly.\n";
    for (const [key, fieldSchema] of Object.entries(this.schema!)) {
      const [value, example] = zodToExample(fieldSchema as z.ZodTypeAny);
      instructions += `\n- Use <${key}></${key}> tags to indicate the answer for ${key}. The answer must be a ${value}.\n  Example: <${key}>${JSON.stringify(example)}</${key}>\n`;
    }

    return instructions + message;
  }
}
