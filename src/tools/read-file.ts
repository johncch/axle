import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Tool } from "./types.js";

const readFileSchema = z.object({
  path: z.string().describe("The file path to read from"),
});

const readFileTool: Tool<typeof readFileSchema> = {
  name: "read-file",
  description: "Read the contents of a file from disk",
  schema: readFileSchema,
  summarize: ({ path }) => path,
  execute: async ({ path }) => {
    try {
      const content = await readFile(path, "utf-8");
      return content;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to read file "${path}": ${error.message}`);
      }
      throw error;
    }
  },
};

export default readFileTool;
