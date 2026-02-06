import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { Tool } from "./types.js";

const patchFileSchema = z.object({
  path: z.string().describe("The file path to patch"),
  old_string: z.string().describe("The exact text to find and replace"),
  new_string: z.string().describe("The replacement text"),
  start_line: z.number().int().positive().describe("1-indexed start line of the region to match within"),
  end_line: z.number().int().positive().describe("1-indexed end line (inclusive) of the region to match within"),
});

const patchFileTool: Tool<typeof patchFileSchema> = {
  name: "patch-file",
  description: "Patch a file by replacing an exact string match within a specified line range",
  schema: patchFileSchema,
  execute: async ({ path, old_string, new_string, start_line, end_line }) => {
    if (end_line < start_line) {
      throw new Error(`end_line (${end_line}) must be >= start_line (${start_line})`);
    }

    let content: string;
    try {
      content = await readFile(path, "utf-8");
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to read file "${path}": ${error.message}`);
      }
      throw error;
    }

    const lines = content.split("\n");
    if (start_line > lines.length) {
      throw new Error(
        `start_line (${start_line}) exceeds file length (${lines.length} lines)`,
      );
    }
    if (end_line > lines.length) {
      throw new Error(
        `end_line (${end_line}) exceeds file length (${lines.length} lines)`,
      );
    }

    const regionLines = lines.slice(start_line - 1, end_line);
    const region = regionLines.join("\n");

    const firstIndex = region.indexOf(old_string);
    if (firstIndex === -1) {
      throw new Error(
        `old_string not found within lines ${start_line}-${end_line} of "${path}"`,
      );
    }

    const secondIndex = region.indexOf(old_string, firstIndex + 1);
    if (secondIndex !== -1) {
      throw new Error(
        `old_string matches multiple times within lines ${start_line}-${end_line} of "${path}"`,
      );
    }

    const patchedRegion = region.replace(old_string, new_string);
    const patchedLines = [
      ...lines.slice(0, start_line - 1),
      ...patchedRegion.split("\n"),
      ...lines.slice(end_line),
    ];
    const patchedContent = patchedLines.join("\n");

    try {
      await writeFile(path, patchedContent, "utf-8");
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to write file "${path}": ${error.message}`);
      }
      throw error;
    }

    return `Successfully patched "${path}" (lines ${start_line}-${end_line})`;
  },
};

export default patchFileTool;
