import { type FileInfo, isTextFileInfo } from "../utils/file.js";
import type { OutputSchema } from "./parse.js";

export class Instruct<TSchema extends OutputSchema | undefined = undefined> {
  prompt: string;
  inputs: Record<string, string> = {};
  files: FileInfo[] = [];
  textReferences: Array<{ content: string; name?: string }> = [];
  instructions: string[] = [];

  schema: TSchema;

  constructor(prompt: string, schema?: TSchema) {
    this.prompt = prompt;
    this.schema = schema as TSchema;
  }

  setInputs(inputs: Record<string, string>) {
    this.inputs = inputs;
  }

  addInput(name: string, value: string) {
    this.inputs[name] = value;
  }

  addFile(file: FileInfo | string, options?: { name?: string }) {
    if (typeof file === "string") {
      this.textReferences.push({ content: file, name: options?.name });
      return;
    }
    if (isTextFileInfo(file)) {
      this.textReferences.push({ content: file.source.content, name: options?.name ?? file.name });
      return;
    }
    this.files.push(options?.name ? { ...file, name: options.name } : file);
  }

  addInstructions(instruction: string) {
    if (typeof instruction !== "string" || instruction.trim() === "") {
      throw new Error("Instruction must be a non-empty string");
    }
    this.instructions.push(instruction);
  }

  hasFiles(): boolean {
    return this.files.length > 0;
  }
}
