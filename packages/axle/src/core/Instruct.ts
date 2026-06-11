import { InstructVariableError } from "../errors/InstructVariableError.js";
import type { MessageMetadata } from "../messages/message.js";
import type { FileInfo } from "../utils/file.js";
import { MissingVariablesError, replaceVariables } from "../utils/replace.js";
import type { OutputSchema } from "./parse.js";
import { zodToExample, zodToFieldDescriptions } from "./parse.js";

export type InstructInputs = Record<string, unknown>;
export type InstructVarsMode = "required" | "optional";

export interface InstructContextSection {
  content: string;
  title?: string;
}

export interface InstructOptions<
  TSchema extends OutputSchema | undefined = OutputSchema | undefined,
> {
  prompt: string;
  schema?: TSchema;
  vars?: InstructVarsMode;
  metadata?: MessageMetadata;
}

export class Instruct<TSchema extends OutputSchema | undefined = undefined> {
  prompt: string;
  inputs: InstructInputs = {};
  files: FileInfo[] = [];
  textReferences: Array<{ content: string; name?: string }> = [];
  contextSections: InstructContextSection[] = [];
  vars: InstructVarsMode;
  metadata?: MessageMetadata;

  schema: TSchema;

  constructor(options: InstructOptions<TSchema>) {
    this.prompt = options.prompt;
    this.schema = options.schema as TSchema;
    this.vars = options.vars ?? "required";
    this.metadata = options.metadata;
  }

  clone(): Instruct<TSchema> {
    const instruct = new Instruct({
      prompt: this.prompt,
      schema: this.schema,
      vars: this.vars,
      metadata: this.metadata,
    });
    instruct.inputs = { ...this.inputs };
    instruct.files = [...this.files];
    instruct.textReferences = this.textReferences.map((reference) => ({ ...reference }));
    instruct.contextSections = this.contextSections.map((section) => ({ ...section }));
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

  /** Append host-supplied supporting material without modifying the authored prompt. */
  addContext(content: string, options?: { title?: string }): this {
    this.contextSections.push({
      content,
      ...(options?.title ? { title: options.title } : {}),
    });
    return this;
  }

  hasFiles(): boolean {
    return this.files.length > 0;
  }

  render(options: { vars?: InstructVarsMode } = {}): string {
    let message: string;
    try {
      message = replaceVariables(this.prompt, this.inputs, {
        strict: (options.vars ?? this.vars) === "required",
      });
    } catch (error) {
      if (error instanceof MissingVariablesError) {
        throw new InstructVariableError(error.missingVariables);
      }
      throw error;
    }

    if (this.textReferences.length > 0) {
      for (const [index, ref] of this.textReferences.entries()) {
        const referenceTitle = ref.name ? `: ${ref.name}` : "";
        const fence = getMarkdownFence(ref.content);
        message += `\n\n## Reference ${index + 1}${referenceTitle}\n\n${fence}\n${ref.content}\n${fence}`;
      }
    }

    for (const [index, section] of this.contextSections.entries()) {
      const contextTitle = section.title ? `: ${section.title}` : "";
      const fence = getMarkdownFence(section.content);
      message += `\n\n## Context ${index + 1}${contextTitle}\n\n${fence}\n${section.content}\n${fence}`;
    }

    if (!this.schema) return message;

    let instructions =
      "# Output Format Instructions\n\nReturn only valid JSON matching this schema. Do not wrap it in markdown. Do not include prose before or after the JSON.\n";
    const [, example] = zodToExample(this.schema);
    for (const [key, value] of zodToFieldDescriptions(this.schema)) {
      instructions += `\n- ${key}: ${value}`;
    }
    instructions += `\n\nExample:\n${JSON.stringify(example, null, 2)}\n\n`;

    return instructions + message;
  }
}

function getMarkdownFence(content: string): string {
  const longestBacktickRun = Math.max(
    0,
    ...Array.from(content.matchAll(/`+/g), (match) => match[0].length),
  );
  return "`".repeat(Math.max(3, longestBacktickRun + 1));
}
