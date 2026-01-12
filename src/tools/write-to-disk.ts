import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { Tool } from "./types.js";

const writeToDiskSchema = z.object({
  path: z.string().describe("The file path to write to"),
  content: z.string().describe("The content to write to the file"),
});

const writeToDiskTool: Tool<typeof writeToDiskSchema> = {
  name: "write-to-disk",
  description: "Write content to a file on disk, creating directories if needed",
  schema: writeToDiskSchema,
  execute: async ({ path, content }) => {
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf-8");
      return `Successfully wrote ${content.length} characters to "${path}"`;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to write file "${path}": ${error.message}`);
      }
      throw error;
    }
  },
};

export default writeToDiskTool;
