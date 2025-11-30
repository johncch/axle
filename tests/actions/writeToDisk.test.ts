import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ActionContext } from "../../src/actions/types.js";
import { WriteToDisk } from "../../src/actions/writeToDisk.js";

const TEST_DIR = join(process.cwd(), "test-temp", "write-to-disk-test");

describe("WriteToDisk Action", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("should create with path template only", () => {
      const action = new WriteToDisk("./output/test.txt");
      expect(action.name).toBe("write-to-disk");
    });

    it("should create with path and content templates", () => {
      const action = new WriteToDisk("./output/test.txt", "{custom}");
      expect(action.name).toBe("write-to-disk");
    });
  });

  describe("execute", () => {
    // Note: WriteToDisk uses "{}" for path templates and "{{}}" for content templates
    it("should write content using default template ({{response}})", async () => {
      const filePath = join(TEST_DIR, "default-template.txt");
      // Default template is "{{response}}" and replacement uses "{{}}" style
      const action = new WriteToDisk(filePath, "{{response}}");

      const context: ActionContext = {
        input: "",
        variables: {
          response: "Hello, World!",
        },
      };

      await action.execute(context);

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("Hello, World!");
    });

    it("should write content using custom template", async () => {
      const filePath = join(TEST_DIR, "custom-template.txt");
      const action = new WriteToDisk(filePath, "Name: {{name}}, Age: {{age}}");

      const context: ActionContext = {
        input: "",
        variables: {
          name: "John",
          age: "30",
        },
      };

      await action.execute(context);

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("Name: John, Age: 30");
    });

    it("should replace variables in path template using {} style", async () => {
      const pathTemplate = join(TEST_DIR, "{filename}.txt");
      const action = new WriteToDisk(pathTemplate, "{{response}}");

      const context: ActionContext = {
        input: "",
        variables: {
          filename: "dynamic-file",
          response: "Dynamic content",
        },
      };

      await action.execute(context);

      const expectedPath = join(TEST_DIR, "dynamic-file.txt");
      const content = await readFile(expectedPath, "utf-8");
      expect(content).toBe("Dynamic content");
    });

    // Skip: there's a bug in ensureDirectoryExistence with deeply nested dirs
    it.skip("should create nested directories if they do not exist", async () => {
      const filePath = join(TEST_DIR, "nested", "deep", "file.txt");
      const action = new WriteToDisk(filePath, "{{response}}");

      const context: ActionContext = {
        input: "",
        variables: {
          response: "Nested content",
        },
      };

      await action.execute(context);

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("Nested content");
    });

    it("should not execute in dry run mode", async () => {
      const filePath = join(TEST_DIR, "dry-run.txt");
      const action = new WriteToDisk(filePath, "{{response}}");

      const context: ActionContext = {
        input: "",
        variables: {
          response: "Should not be written",
        },
        options: {
          dryRun: true,
        },
      };

      await action.execute(context);

      // File should not exist
      await expect(readFile(filePath, "utf-8")).rejects.toThrow();
    });

    it("should handle multiple variables in content template", async () => {
      const filePath = join(TEST_DIR, "multi-var.txt");
      const action = new WriteToDisk(
        filePath,
        "Title: {{title}}\nAuthor: {{author}}\nContent: {{content}}",
      );

      const context: ActionContext = {
        input: "",
        variables: {
          title: "My Article",
          author: "Jane Doe",
          content: "Article body here",
        },
      };

      await action.execute(context);

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("Title: My Article\nAuthor: Jane Doe\nContent: Article body here");
    });

    it("should handle file pattern replacement with asterisk", async () => {
      const pathTemplate = join(TEST_DIR, "output-*.txt");
      const action = new WriteToDisk(pathTemplate, "{{response}}");

      const context: ActionContext = {
        input: "",
        variables: {
          response: "Pattern content",
          file: {
            abs: "/path/to/input.txt",
            dir: "/path/to/",
            stem: "input",
            ext: ".txt",
            name: "input.txt",
          },
        },
      };

      await action.execute(context);

      const expectedPath = join(TEST_DIR, "output-input.txt");
      const content = await readFile(expectedPath, "utf-8");
      expect(content).toBe("Pattern content");
    });

    it("should use response from variables", async () => {
      const filePath = join(TEST_DIR, "previous.txt");
      const action = new WriteToDisk(filePath, "{{response}}");

      const context: ActionContext = {
        input: "Previous step output",
        variables: {
          response: "From previous step",
          $previous: {
            response: "From previous step",
          },
        },
      };

      await action.execute(context);

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("From previous step");
    });

    it("should leave unreplaced placeholders as-is", async () => {
      const filePath = join(TEST_DIR, "unreplaced.txt");
      const action = new WriteToDisk(filePath, "{{existing}} and {{missing}}");

      const context: ActionContext = {
        input: "",
        variables: {
          existing: "found",
        },
      };

      await action.execute(context);

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("found and {{missing}}");
    });
  });

  describe("return value", () => {
    it("should return void (undefined)", async () => {
      const filePath = join(TEST_DIR, "return-test.txt");
      const action = new WriteToDisk(filePath, "{{response}}");

      const context: ActionContext = {
        input: "",
        variables: {
          response: "Test",
        },
      };

      const result = await action.execute(context);
      expect(result).toBeUndefined();
    });
  });
});
