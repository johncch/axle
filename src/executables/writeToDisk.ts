import * as z from "zod";
import { Executable, ExecutableContext } from "../types.js";
import {
  replaceFilePattern,
  writeFileWithDirectories,
} from "../utils/file.js";
import { replaceVariables } from "../utils/replace.js";
import { FilePathInfo } from "../utils/types.js";

const writeToDiskSchema = z.object({
  output: z.string().describe("The file path to write to"),
  keys: z
    .array(z.string())
    .default(["response"])
    .describe("Variable names to write to the file"),
});

const writeToDiskExecutable: Executable<
  z.infer<typeof writeToDiskSchema>,
  void
> = {
  name: "write-to-disk",
  description: "Write variables to a file on disk",
  schema: writeToDiskSchema,

  async execute(
    params: z.infer<typeof writeToDiskSchema>,
    context: ExecutableContext,
  ): Promise<void> {
    const { output, keys } = params;
    const { variables, options, recorder } = context;

    if (options?.warnUnused) {
      const unusedKeys = keys.filter((key) => !(key in variables));
      if (unusedKeys.length > 0) {
        recorder?.warn?.log(
          `[Write To Disk] The following keys were not found in the variables: ${unusedKeys.join(", ")}`,
        );
      }
    }

    let content = "";
    if (keys.length === 1) {
      content = variables[keys[0]] ?? "<not found>";
    } else {
      content = keys
        .map((key) => `[${key}]:\n${variables[key] ?? "<not found>"}\n`)
        .join("\n");
    }

    if (options?.dryRun) {
      recorder?.info?.log(`[Dry run] Write to Disk is not executed.`);
      return;
    }

    let filepath = "";
    if (output.includes("*")) {
      filepath = replaceFilePattern(output, variables.file as FilePathInfo);
    } else {
      filepath = replaceVariables(output, variables, "{}");
    }

    await writeFileWithDirectories({
      filePath: filepath,
      content,
    });
  },
};

export default writeToDiskExecutable;
