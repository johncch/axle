import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import readFileTool from "../../src/tools/read-file.js";

const TEST_DIR = join(import.meta.dirname, "__read_file_test_tmp__");

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("readFileTool", () => {
  it("should have correct name and schema", () => {
    expect(readFileTool.name).toBe("read-file");
    expect(readFileTool.schema.shape.path).toBeDefined();
  });

  it("should read an existing file", async () => {
    const filePath = join(TEST_DIR, "hello.txt");
    await writeFile(filePath, "hello world", "utf-8");
    const result = await readFileTool.execute({ path: filePath });
    expect(result).toBe("hello world");
  });

  it("should throw on missing file", async () => {
    const filePath = join(TEST_DIR, "nonexistent.txt");
    await expect(readFileTool.execute({ path: filePath })).rejects.toThrow(
      /Failed to read file/,
    );
  });
});
