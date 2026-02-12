import type { Tool } from "../tools/types.js";
import { Base64FileInfo, FileInfo, isBase64FileInfo, isTextFileInfo } from "../utils/file.js";
import type { OutputSchema } from "./parse.js";

export class Instruct {
  readonly name = "instruct";

  prompt: string;
  system: string | null = null;
  inputs: Record<string, string> = {};
  tools: Record<string, Tool> = {};
  files: Base64FileInfo[] = [];
  textReferences: Array<{ content: string; name?: string }> = [];
  instructions: string[] = [];

  schema: OutputSchema | undefined;

  constructor(prompt: string, schema?: OutputSchema) {
    this.prompt = prompt;
    this.schema = schema;
  }

  setInputs(inputs: Record<string, string>) {
    this.inputs = inputs;
  }

  addInput(name: string, value: string) {
    this.inputs[name] = value;
  }

  addTools(tools: Tool[]) {
    for (const tool of tools) {
      this.tools[tool.name] = tool;
    }
  }

  addTool(tool: Tool) {
    this.tools[tool.name] = tool;
  }

  hasTools(): boolean {
    return Object.keys(this.tools).length > 0;
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
