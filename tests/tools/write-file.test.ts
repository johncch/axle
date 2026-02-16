import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import writeFileTool from "../../src/tools/write-file.js";

const TEST_DIR = join(import.meta.dirname, "__write_file_test_tmp__");

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("writeFileTool", () => {
  it("should have correct name and schema", () => {
    expect(writeFileTool.name).toBe("write-file");
    expect(writeFileTool.schema.shape.path).toBeDefined();
    expect(writeFileTool.schema.shape.content).toBeDefined();
  });

  it("should write a file and return success message", async () => {
    const filePath = join(TEST_DIR, "hello.txt");
    const result = await writeFileTool.execute({ path: filePath, content: "hello world" });
    expect(result).toBe(`Successfully wrote 11 characters to "${filePath}"`);
    const written = await readFile(filePath, "utf-8");
    expect(written).toBe("hello world");
  });

  it("should create intermediate directories", async () => {
    const filePath = join(TEST_DIR, "a", "b", "c", "deep.txt");
    await writeFileTool.execute({ path: filePath, content: "deep" });
    const written = await readFile(filePath, "utf-8");
    expect(written).toBe("deep");
  });

  it("should overwrite an existing file", async () => {
    const filePath = join(TEST_DIR, "overwrite.txt");
    await writeFileTool.execute({ path: filePath, content: "first" });
    await writeFileTool.execute({ path: filePath, content: "second" });
    const written = await readFile(filePath, "utf-8");
    expect(written).toBe("second");
  });

  it("should throw on invalid path", async () => {
    await expect(
      writeFileTool.execute({ path: "/dev/null/impossible/file.txt", content: "x" }),
    ).rejects.toThrow(/Failed to write file/);
  });
});
