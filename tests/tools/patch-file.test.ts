import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import patchFileTool from "../../src/tools/patch-file.js";

const TEST_DIR = join(import.meta.dirname, "__patch_file_test_tmp__");

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

async function writeTestFile(name: string, content: string): Promise<string> {
  const filePath = join(TEST_DIR, name);
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

describe("patchFileTool", () => {
  it("should have correct name and schema", () => {
    expect(patchFileTool.name).toBe("patch-file");
    expect(patchFileTool.schema.shape.path).toBeDefined();
    expect(patchFileTool.schema.shape.old_string).toBeDefined();
    expect(patchFileTool.schema.shape.new_string).toBeDefined();
    expect(patchFileTool.schema.shape.start_line).toBeDefined();
    expect(patchFileTool.schema.shape.end_line).toBeDefined();
  });

  it("should patch a single occurrence in the line range", async () => {
    const filePath = await writeTestFile("test.txt", "line1\nline2\nline3\nline4\n");
    const result = await patchFileTool.execute({
      path: filePath,
      old_string: "line2",
      new_string: "LINE_TWO",
      start_line: 2,
      end_line: 2,
    });
    expect(result).toContain("Successfully patched");
    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("line1\nLINE_TWO\nline3\nline4\n");
  });

  it("should fail when old_string is not found in range", async () => {
    const filePath = await writeTestFile("test.txt", "aaa\nbbb\nccc\n");
    await expect(
      patchFileTool.execute({
        path: filePath,
        old_string: "zzz",
        new_string: "yyy",
        start_line: 1,
        end_line: 3,
      }),
    ).rejects.toThrow(/old_string not found/);
  });

  it("should fail when old_string matches multiple times in range", async () => {
    const filePath = await writeTestFile("test.txt", "foo\nfoo\nbar\n");
    await expect(
      patchFileTool.execute({
        path: filePath,
        old_string: "foo",
        new_string: "baz",
        start_line: 1,
        end_line: 2,
      }),
    ).rejects.toThrow(/matches multiple times/);
  });

  it("should succeed when old_string exists elsewhere but only once in range", async () => {
    const filePath = await writeTestFile("test.txt", "foo\nbar\nfoo\nbaz\n");
    await patchFileTool.execute({
      path: filePath,
      old_string: "foo",
      new_string: "qux",
      start_line: 3,
      end_line: 3,
    });
    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("foo\nbar\nqux\nbaz\n");
  });

  it("should handle patching the first line", async () => {
    const filePath = await writeTestFile("test.txt", "alpha\nbeta\ngamma\n");
    await patchFileTool.execute({
      path: filePath,
      old_string: "alpha",
      new_string: "ALPHA",
      start_line: 1,
      end_line: 1,
    });
    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("ALPHA\nbeta\ngamma\n");
  });

  it("should handle patching the last line", async () => {
    const filePath = await writeTestFile("test.txt", "alpha\nbeta\ngamma");
    await patchFileTool.execute({
      path: filePath,
      old_string: "gamma",
      new_string: "GAMMA",
      start_line: 3,
      end_line: 3,
    });
    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("alpha\nbeta\nGAMMA");
  });

  it("should handle a multi-line range", async () => {
    const filePath = await writeTestFile("test.txt", "a\nb\nc\nd\ne\n");
    await patchFileTool.execute({
      path: filePath,
      old_string: "b\nc\nd",
      new_string: "B\nC\nD",
      start_line: 2,
      end_line: 4,
    });
    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("a\nB\nC\nD\ne\n");
  });

  it("should throw when end_line < start_line", async () => {
    const filePath = await writeTestFile("test.txt", "a\nb\nc\n");
    await expect(
      patchFileTool.execute({
        path: filePath,
        old_string: "a",
        new_string: "A",
        start_line: 3,
        end_line: 1,
      }),
    ).rejects.toThrow(/end_line.*must be >= start_line/);
  });

  it("should throw when start_line exceeds file length", async () => {
    const filePath = await writeTestFile("test.txt", "a\nb\n");
    await expect(
      patchFileTool.execute({
        path: filePath,
        old_string: "a",
        new_string: "A",
        start_line: 10,
        end_line: 10,
      }),
    ).rejects.toThrow(/start_line.*exceeds file length/);
  });

  it("should throw when file does not exist", async () => {
    const filePath = join(TEST_DIR, "nonexistent.txt");
    await expect(
      patchFileTool.execute({
        path: filePath,
        old_string: "a",
        new_string: "b",
        start_line: 1,
        end_line: 1,
      }),
    ).rejects.toThrow(/Failed to read file/);
  });
});
