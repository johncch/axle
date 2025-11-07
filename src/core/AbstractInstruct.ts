import * as z from "zod/v4";
import { Recorder } from "../recorder/recorder.js";
import { ToolExecutable } from "../tools/types.js";
import { Task } from "../types.js";
import {
  Base64FileInfo,
  FileInfo,
  isBase64FileInfo,
  isTextFileInfo,
  TextFileInfo,
} from "../utils/file.js";
import { replaceVariables } from "../utils/replace.js";
import { zodToExample } from "./typecheck.js";
import { InferedOutputSchema, OutputSchema } from "./types.js";

export abstract class AbstractInstruct<T extends OutputSchema> implements Task {
  readonly type = "instruct";

  prompt: string;
  system: string | null = null;
  inputs: Record<string, string> = {};
  tools: Record<string, ToolExecutable> = {};
  files: Base64FileInfo[] = [];
  textReferences: Array<{ content: string; name?: string }> = [];
  instructions: string[] = [];

  schema: T;
  rawResponse: string;
  protected _taggedSections:
    | {
        tags: Record<string, string>;
        remaining: string;
      }
    | undefined = undefined;
  protected _result: InferedOutputSchema<T> | undefined = undefined;

  protected constructor(prompt: string, schema: T) {
    this.prompt = prompt;
    this.schema = schema;
  }

  setInputs(inputs: Record<string, string>) {
    this.inputs = inputs;
  }

  addInput(name: string, value: string) {
    this.inputs[name] = value;
  }

  addTools(tools: ToolExecutable[]) {
    for (const tool of tools) {
      this.tools[tool.name] = tool;
    }
  }

  addTool(tool: ToolExecutable) {
    this.tools[tool.name] = tool;
  }

  addImage(file: FileInfo) {
    if (file.type !== "image") {
      throw new Error(`Expected image file, got ${file.type}`);
    }
    const imageFile = file as Base64FileInfo;
    this.files.push(imageFile);
  }

  addDocument(file: FileInfo) {
    if (file.type !== "document") {
      throw new Error(`Expected document file, got ${file.type}`);
    }
    const docFile = file as Base64FileInfo;
    this.files.push(docFile);
  }

  addFile(file: FileInfo) {
    if (!isBase64FileInfo(file)) {
      throw new Error(`Expected image or document file, got ${file.type}`);
    }
    this.files.push(file);
  }

  addReference(
    textFile: FileInfo | TextFileInfo | string,
    options?: { name?: string },
  ) {
    if (typeof textFile === "string") {
      this.textReferences.push({
        content: textFile,
        name: options?.name,
      });
      return;
    }

    if (isTextFileInfo(textFile)) {
      this.textReferences.push({
        content: textFile.content,
        name: options?.name ?? textFile.name,
      });
    } else {
      throw new Error(`Expected text file, got ${textFile.type}`);
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

  get result(): InferedOutputSchema<T> | undefined {
    return this._result;
  }

  compile(
    variables: Record<string, string>,
    runtime: {
      recorder?: Recorder;
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
      recorder?: Recorder;
      options?: { warnUnused?: boolean };
    } = {},
  ): string {
    const { recorder, options } = runtime;
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
        recorder?.error.log(
          `Warning unused variables ${unreplaced.join(", ")}`,
        );
        throw new Error(`Unused variables: ${unreplaced.join(", ")}`);
      }
    }
    return finalPrompt;
  }

  protected createInstructions(instructions: string = ""): string {
    instructions = "# Instructions\n\n" + instructions;

    const schemaKeys = Object.keys(this.schema);
    if (schemaKeys.length > 0) {
      instructions += "## Output Format Instructions\n";
      instructions +=
        "\nHere is how you should format your output. Follow the instructions strictly.\n";

      for (const [key, fieldSchema] of Object.entries(this.schema)) {
        const fieldInstructions = this.generateFieldInstructions(
          key,
          fieldSchema,
        );
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

  protected generateFieldInstructions(
    key: string,
    schema: z.ZodTypeAny,
  ): string {
    const [value, example] = zodToExample(schema);
    return `\n- Use <${key}></${key}> tags to indicate the answer for ${key}. The answer must be a ${value}.\n  Example: <${key}>${JSON.stringify(example)}</${key}>\n`;
  }

  finalize(
    rawValue: string,
    runtime: { recorder?: Recorder } = {},
  ): InferedOutputSchema<T> {
    const { recorder } = runtime;
    this.rawResponse = rawValue;

    // Handle empty schema case
    const schemaKeys = Object.keys(this.schema);
    if (schemaKeys.length === 0) {
      if (rawValue.trim() === "{}" || rawValue.trim() === "") {
        this._result = {} as InferedOutputSchema<T>;
        return this._result;
      }
      throw new Error(
        "Schema is empty, but rawValue is not an empty object representation or empty string.",
      );
    }

    this._taggedSections =
      this._taggedSections || this.parseTaggedSections(rawValue);

    const parseInput: any = {};
    for (const [key, fieldSchema] of Object.entries(this.schema)) {
      const tagContent = this._taggedSections.tags[key];
      if (tagContent !== undefined) {
        parseInput[key] = this.preprocessValue(fieldSchema, tagContent);
      } else if (fieldSchema.def.type !== "optional") {
        throw new Error(
          `Expected results with tag ${key} but it does not exist`,
        );
      }
    }

    try {
      const validatedResult: any = {};
      for (const [key, fieldSchema] of Object.entries(this.schema)) {
        if (key in parseInput) {
          validatedResult[key] = fieldSchema.parse(parseInput[key]);
        }
      }

      this._result = validatedResult as InferedOutputSchema<T>;
      return this._result;
    } catch (error) {
      if (error && typeof error === "object" && "issues" in error) {
        const formattedErrors = (error as any).issues
          .map((err: any) => `${err.path.join(".")}: ${err.message}`)
          .join(", ");
        throw new Error(`Validation failed: ${formattedErrors}`);
      }
      throw error;
    }
  }

  private preprocessValue(schema: z.ZodTypeAny, rawValue: string): any {
    rawValue = rawValue.trim();
    switch (schema.def.type) {
      case "string":
        try {
          const parsed = JSON.parse(rawValue);
          return parsed;
        } catch (e) {
          if (typeof rawValue === "string") {
            return rawValue;
          }
          throw new Error(
            `Cannot parse '${rawValue}' as string. Ensure it is a valid JSON string or a plain string.`,
          );
        }
      case "number": {
        const parsed = parseFloat(rawValue);
        if (isNaN(parsed)) {
          throw new Error(`Cannot parse '${rawValue}' as number`);
        }
        return parsed;
      }
      case "boolean": {
        const lowerValue = rawValue.toLowerCase();
        if (lowerValue === "true") return true;
        if (lowerValue === "false") return false;
        throw new Error(
          `Cannot parse '${rawValue}' as boolean. Expected 'true' or 'false'`,
        );
      }
      case "array": {
        if (rawValue === "") return [];
        try {
          const parsed = JSON.parse(rawValue);
          if (Array.isArray(parsed)) {
            return parsed;
          }
        } catch (e) {
          // If JSON parsing fails, fall back to line-by-line parsing
        }

        if (rawValue.includes(",")) {
          return rawValue
            .split(",")
            .map((s) => {
              const trimmed = s.trim();
              try {
                return JSON.parse(trimmed);
              } catch (e) {
                return trimmed;
              }
            })
            .filter((item) => item !== "");
        }
      }
      case "object": {
        if (rawValue.includes("```json")) {
          rawValue = rawValue.replace(/```json/g, "").replace(/```/g, "");
        }
        try {
          const parsed = JSON.parse(rawValue);
          return parsed;
        } catch (error) {
          throw new Error(`Cannot parse object as JSON: ${error.message}`);
        }
      }
      case "optional": {
        const innerSchema = (schema as any).def.innerType as z.ZodTypeAny;
        return this.preprocessValue(innerSchema, rawValue);
      }
      default:
        return rawValue;
    }
  }

  protected parseTaggedSections(input: string): {
    tags: Record<string, string>;
    remaining: string;
  } {
    // Unwrap JSON code blocks (this is mostly for smaller models)
    if (input.trim().startsWith("```json") && input.trim().endsWith("```")) {
      input = input.trim().slice(7, -3).trim(); // Remove ```json from start and ``` from end
    }
    const tagRegex = /<(\w+)>(.*?)<\/\1>/gs;
    const tags: Record<string, string> = {};
    let remaining = input;

    remaining = remaining.replace(tagRegex, (_match, tag, content) => {
      tags[tag] = content;
      return "";
    });

    // This is also for smaller models when they open but don't close the tags.
    const tagRegexPartial = /<(\w+)>(.*?)(?:<\/?\w+>|$)/gs;
    remaining = remaining.replace(tagRegexPartial, (_match, tag, content) => {
      tags[tag] = content;
      return "";
    });

    return {
      tags,
      remaining: remaining.trim(),
    };
  }
}
