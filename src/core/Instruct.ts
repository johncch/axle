import * as z from "zod";
import type { TracingContext } from "../tracer/types.js";
import type { Tool } from "../tools/types.js";
import {
  Base64FileInfo,
  FileInfo,
  isBase64FileInfo,
  isTextFileInfo,
} from "../utils/file.js";
import { replaceVariables } from "../utils/replace.js";
import { OutputSchema, zodToExample } from "./parse.js";

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

  hasTools(): boolean {
    return Object.keys(this.tools).length > 0;
  }

  hasFiles(): boolean {
    return this.files.length > 0;
  }

  compile(
    variables: Record<string, string> = {},
    runtime: {
      tracer?: TracingContext;
      options?: { warnUnused?: boolean };
    } = {},
  ): { message: string; instructions: string } {
    const userPrompt = this.createUserMessage(variables, runtime);
    const instructionPrompt = this.createInstructions();

    return {
      message: userPrompt,
      instructions: instructionPrompt,
    };
  }

  protected createUserMessage(
    variables: Record<string, string>,
    runtime: {
      tracer?: TracingContext;
      options?: { warnUnused?: boolean };
    } = {},
  ): string {
    const { tracer, options } = runtime;
    const allVars = { ...variables, ...this.inputs };
    let finalPrompt = replaceVariables(this.prompt, allVars);

    if (this.textReferences.length > 0) {
      for (const [index, ref] of this.textReferences.entries()) {
        const referenceTitle = ref.name ? `: ${ref.name}` : "";
        finalPrompt += `\n\n## Reference ${index + 1}${referenceTitle}\n\n\`\`\`${ref.content}\'\'\'`;
      }
    }

    if (options?.warnUnused) {
      const unreplaced = finalPrompt.match(/\{\{(.*?)\}\}/g);
      if (unreplaced) {
        tracer?.error(`Warning unused variables ${unreplaced.join(", ")}`);
        throw new Error(`Unused variables: ${unreplaced.join(", ")}`);
      }
    }
    return finalPrompt;
  }

  protected createInstructions(instructions: string = ""): string {
    instructions = "# Instructions\n\n" + instructions;

    const schemaKeys = this.schema ? Object.keys(this.schema) : [];
    if (schemaKeys.length > 0) {
      instructions += "## Output Format Instructions\n";
      instructions +=
        "\nHere is how you should format your output. Follow the instructions strictly.\n";

      for (const [key, fieldSchema] of Object.entries(this.schema!)) {
        const fieldInstructions = this.generateFieldInstructions(key, fieldSchema);
        instructions += fieldInstructions;
      }
    }

    if (this.instructions.length > 0) {
      instructions += "\n## Additional Instructions\n\n";
      for (const instruction of this.instructions) {
        instructions += `- ${instruction}\n`;
      }
    }

    return instructions;
  }

  protected generateFieldInstructions(key: string, schema: z.ZodTypeAny): string {
    const [value, example] = zodToExample(schema);
    return `\n- Use <${key}></${key}> tags to indicate the answer for ${key}. The answer must be a ${value}.\n  Example: <${key}>${JSON.stringify(example)}</${key}>\n`;
  }
}
