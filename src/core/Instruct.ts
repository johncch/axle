import { Base64FileInfo, FileInfo, isBase64FileInfo, isTextFileInfo } from "../utils/file.js";
import type { OutputSchema } from "./parse.js";

export class Instruct<TSchema extends OutputSchema | undefined = undefined> {
  prompt: string;
  inputs: Record<string, string> = {};
  files: Base64FileInfo[] = [];
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
    if (isBase64FileInfo(file)) {
      this.files.push(file);
    } else if (isTextFileInfo(file)) {
      this.textReferences.push({ content: file.content, name: options?.name ?? file.name });
    }
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
