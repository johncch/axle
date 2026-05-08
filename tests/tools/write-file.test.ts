import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../../src/tools/registry.js";
import writeFileTool from "../../src/tools/write-file.js";

const TEST_DIR = join(import.meta.dirname, "__write_file_test_tmp__");
const ctx = {
  signal: new AbortController().signal,
  registry: new ToolRegistry(),
  emit: () => {},
};

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("writeFileTool", () => {
  it("should write a file and return success message", async () => {
    const filePath = join(TEST_DIR, "hello.txt");
    const result = await writeFileTool.execute({ path: filePath, content: "hello world" }, ctx);
    expect(result).toBe(`Successfully wrote 11 characters to "${filePath}"`);
    const written = await readFile(filePath, "utf-8");
    expect(written).toBe("hello world");
  });

  it("should create intermediate directories", async () => {
    const filePath = join(TEST_DIR, "a", "b", "c", "deep.txt");
    await writeFileTool.execute({ path: filePath, content: "deep" }, ctx);
    const written = await readFile(filePath, "utf-8");
    expect(written).toBe("deep");
  });

  it("should overwrite an existing file", async () => {
    const filePath = join(TEST_DIR, "overwrite.txt");
    await writeFileTool.execute({ path: filePath, content: "first" }, ctx);
    await writeFileTool.execute({ path: filePath, content: "second" }, ctx);
    const written = await readFile(filePath, "utf-8");
    expect(written).toBe("second");
  });

  it("should throw on invalid path", async () => {
    await expect(
      writeFileTool.execute({ path: "/dev/null/impossible/file.txt", content: "x" }, ctx),
    ).rejects.toThrow(/Failed to write file/);
  });
});
