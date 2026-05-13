import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, test } from "vitest";
import * as z from "zod";
import { Instruct } from "../../src/core/Instruct.js";
import { FileInfo, loadFileContent } from "../../src/utils/file.js";

const TEST_DIR = join(process.cwd(), "test-temp", "instruct-test");

describe("Instruct", () => {
  describe("input binding", () => {
    test("withInputs returns a new instruct without mutating the original", () => {
      const template = new Instruct("Hello {{name}}");
      const bound = template.withInputs({ name: "Alice" });

      expect(template).not.toBe(bound);
      expect(template.inputs).toEqual({});
      expect(bound.inputs).toEqual({ name: "Alice" });
      expect(bound.render()).toBe("Hello Alice");
    });

    test("withInput merges into existing inputs on a cloned instruct", () => {
      const template = new Instruct("Hello {{title}} {{name}}").withInputs({ title: "Dr." });
      const bound = template.withInput("name", "Rivera");

      expect(template).not.toBe(bound);
      expect(template.inputs).toEqual({ title: "Dr." });
      expect(bound.inputs).toEqual({ title: "Dr.", name: "Rivera" });
      expect(bound.render()).toBe("Hello Dr. Rivera");
    });

    test("render throws when an input is missing", () => {
      const template = new Instruct("Hello {{name}} from {{place}}").withInput("name", "Alice");

      expect(() => template.render()).toThrow(/Missing variable: place/);
    });

    test("render can leave missing variables unresolved", () => {
      const template = new Instruct("Hello {{name}} from {{place}}").withInput("name", "Alice");

      expect(template.render({ vars: "optional" })).toBe("Hello Alice from {{place}}");
    });

    test("vars option is preserved when cloning", () => {
      const template = new Instruct("Describe a {{breed}}", undefined, {
        vars: "optional",
      }).withInput("name", "Riley");

      expect(template.render()).toBe("Describe a {{breed}}");
      expect(template.vars).toBe("optional");
    });
  });

  describe("file methods", () => {
    test("addFile accepts image files", () => {
      const instruction = new Instruct("Test prompt");
      const imageFile: FileInfo = {
        kind: "image",
        mimeType: "image/jpeg",
        size: 1000,
        name: "image.jpg",
        source: { type: "base64", data: "base64data" },
      };

      instruction.addFile(imageFile);
      expect(instruction.hasFiles()).toBe(true);
      expect(instruction.files).toHaveLength(1);
      expect(instruction.files[0]).toBe(imageFile);
    });

    test("addFile accepts document files", () => {
      const instruction = new Instruct("Test prompt");
      const pdfFile: FileInfo = {
        kind: "document",
        mimeType: "application/pdf",
        size: 1000,
        name: "document.pdf",
        source: { type: "base64", data: "base64data" },
      };

      instruction.addFile(pdfFile);
      expect(instruction.hasFiles()).toBe(true);
      expect(instruction.files).toHaveLength(1);
    });

    test("addFile accepts text files as references", () => {
      const instruction = new Instruct("Test prompt");
      const textFile: FileInfo = {
        kind: "text",
        mimeType: "text/plain",
        size: 11,
        name: "file.txt",
        source: { type: "text", content: "hello world" },
      };

      instruction.addFile(textFile);
      expect(instruction.textReferences).toHaveLength(1);
      expect(instruction.textReferences[0].content).toBe("hello world");
      expect(instruction.textReferences[0].name).toBe("file.txt");
    });

    test("addFile accepts raw strings as references", () => {
      const instruction = new Instruct("Test prompt");
      instruction.addFile("some content", { name: "my ref" });
      expect(instruction.textReferences).toHaveLength(1);
      expect(instruction.textReferences[0].content).toBe("some content");
      expect(instruction.textReferences[0].name).toBe("my ref");
    });

    test("hasFiles returns false when no files added", () => {
      const instruction = new Instruct("Test prompt");
      expect(instruction.hasFiles()).toBe(false);
    });

    test("hasFiles returns true when files are added", () => {
      const instruction = new Instruct("Test prompt");
      const imageFile: FileInfo = {
        kind: "image",
        mimeType: "image/jpeg",
        size: 1000,
        name: "image.jpg",
        source: { type: "base64", data: "base64data" },
      };

      instruction.addFile(imageFile);
      expect(instruction.hasFiles()).toBe(true);
    });

    test("files array starts empty", () => {
      const instruction = new Instruct("Test prompt");
      expect(instruction.files).toHaveLength(0);
    });

    test("multiple files can be added", () => {
      const instruction = new Instruct("Test prompt");
      const file1: FileInfo = {
        kind: "image",
        mimeType: "image/jpeg",
        size: 1000,
        name: "image1.jpg",
        source: { type: "base64", data: "base64data1" },
      };
      const file2: FileInfo = {
        kind: "image",
        mimeType: "image/png",
        size: 2000,
        name: "image2.png",
        source: { type: "base64", data: "base64data2" },
      };

      instruction.addFile(file1);
      instruction.addFile(file2);
      expect(instruction.files).toHaveLength(2);
      expect(instruction.files[0]).toBe(file1);
      expect(instruction.files[1]).toBe(file2);
    });
  });

  describe("with text references", () => {
    beforeEach(async () => {
      await mkdir(TEST_DIR, { recursive: true });
    });

    afterEach(async () => {
      await rm(TEST_DIR, { recursive: true, force: true });
    });

    it("should add text reference to prompt", async () => {
      const textContent = "This is a research paper about machine learning.";
      const filePath = join(TEST_DIR, "paper.txt");
      await writeFile(filePath, textContent);

      const textFile = await loadFileContent(filePath, "utf-8");
      const instruct = new Instruct("Summarize the text");
      instruct.addFile(textFile, { name: "arxiv paper" });

      const compiled = instruct.render();

      expect(compiled).toContain("Summarize the text");
      expect(compiled).toContain("## Reference 1: arxiv paper");
      expect(compiled).toContain(textContent);
    });

    it("should use filename as default reference name", async () => {
      const textContent = "# Important Document\n\nThis contains important information.";
      const filePath = join(TEST_DIR, "document.md");
      await writeFile(filePath, textContent);

      const textFile = await loadFileContent(filePath, "utf-8");
      const instruct = new Instruct("What does this document say?");
      instruct.addFile(textFile);

      const compiled = instruct.render();

      expect(compiled).toContain("What does this document say?");
      expect(compiled).toContain("## Reference 1: document.md");
      expect(compiled).toContain(textContent);
    });

    it("should handle multiple text references", async () => {
      const paper1Content = "First research paper content.";
      const paper2Content = "Second research paper content.";

      const paper1Path = join(TEST_DIR, "paper1.txt");
      const paper2Path = join(TEST_DIR, "paper2.txt");

      await writeFile(paper1Path, paper1Content);
      await writeFile(paper2Path, paper2Content);

      const textFile1 = await loadFileContent(paper1Path, "utf-8");
      const textFile2 = await loadFileContent(paper2Path, "utf-8");

      const instruct = new Instruct("Compare these papers");
      instruct.addFile(textFile1, { name: "Paper A" });
      instruct.addFile(textFile2, { name: "Paper B" });

      const compiled = instruct.render();

      expect(compiled).toContain("Compare these papers");
      expect(compiled).toContain("## Reference 1: Paper A");
      expect(compiled).toContain(paper1Content);
      expect(compiled).toContain("## Reference 2: Paper B");
      expect(compiled).toContain(paper2Content);
    });

    it("should work with variable replacement in main prompt", async () => {
      const textContent = "Document about {{topic}}.";
      const filePath = join(TEST_DIR, "template.txt");
      await writeFile(filePath, textContent);

      const textFile = await loadFileContent(filePath, "utf-8");
      const instruct = new Instruct("Analyze the {{analysis_type}} in this document").withInputs({
        topic: "artificial intelligence",
        analysis_type: "methodology",
      });
      instruct.addFile(textFile, { name: "Reference Doc" });

      const compiled = instruct.render();

      expect(compiled).toContain("Analyze the methodology in this document");
      expect(compiled).toContain("## Reference 1: Reference Doc");
      expect(compiled).toContain("Document about {{topic}}.");
    });

    it("should preserve markdown formatting in references", async () => {
      const markdownContent = `# Title

## Section 1
- Bullet point 1
- Bullet point 2

**Bold text** and *italic text*.

\`\`\`javascript
console.log("code block");
\`\`\``;

      const filePath = join(TEST_DIR, "formatted.md");
      await writeFile(filePath, markdownContent);

      const textFile = await loadFileContent(filePath, "utf-8");
      const instruct = new Instruct("Process this markdown");
      instruct.addFile(textFile, { name: "Markdown Doc" });

      const compiled = instruct.render();

      expect(compiled).toContain("## Reference 1: Markdown Doc");
      expect(compiled).toContain("# Title");
      expect(compiled).toContain("**Bold text**");
      expect(compiled).toContain("```javascript");
    });

    it("should handle empty text files", async () => {
      const filePath = join(TEST_DIR, "empty.txt");
      await writeFile(filePath, "");

      const textFile = await loadFileContent(filePath, "utf-8");
      const instruct = new Instruct("What is in this file?");
      instruct.addFile(textFile, { name: "Empty File" });

      const compiled = instruct.render();

      expect(compiled).toContain("What is in this file?");
      expect(compiled).toContain("## Reference 1: Empty File");
      expect(compiled).toMatch(/## Reference 1: Empty File\s*\n\s*\n/);
    });

    it("should work with structured output format", async () => {
      const textContent = "The score is 85 out of 100.";
      const filePath = join(TEST_DIR, "scores.txt");
      await writeFile(filePath, textContent);

      const textFile = await loadFileContent(filePath, "utf-8");
      const instruct = new Instruct("Extract information", {
        score: z.number(),
        summary: z.string(),
      });
      instruct.addFile(textFile, { name: "Score Data" });

      const compiled = instruct.render();

      expect(compiled).toContain("Extract information");
      expect(compiled).toContain("## Reference 1: Score Data");
      expect(compiled).toContain(textContent);
      expect(compiled).toContain('"score": 42');
      expect(compiled).toContain('"summary": "Your answer"');
    });
  });

  describe("optional schema", () => {
    it("should create instruct without schema", () => {
      const instruct = new Instruct("Hello world");
      expect(instruct.schema).toBeUndefined();
    });

    it("emits message untouched when no schema is set", () => {
      const instruct = new Instruct("Hello world");
      const compiled = instruct.render();
      expect(compiled).toBe("Hello world");
    });

    it("should include output format instructions when schema provided", () => {
      const instruct = new Instruct("Hello world", { answer: z.string() });
      const compiled = instruct.render();
      expect(compiled).toContain("# Output Format Instructions");
      expect(compiled).toContain("Return only a valid JSON object");
      expect(compiled).toContain('"answer": "Your answer"');
    });

    it("renders enum schema examples without throwing", () => {
      const instruct = new Instruct("Classify the run", {
        status: z.enum(["success", "partial", "fail"]),
      });
      const compiled = instruct.render();

      expect(compiled).toContain('- status: "success" | "partial" | "fail"');
      expect(compiled).toContain('"status": "success"');
    });

    it("renders literal schema examples without throwing", () => {
      const instruct = new Instruct("Return the fixed kind", {
        kind: z.literal("foo"),
      });
      const compiled = instruct.render();

      expect(compiled).toContain('- kind: "foo"');
      expect(compiled).toContain('"kind": "foo"');
    });

    it("renders a valid JSON example object with enum and literal values", () => {
      const instruct = new Instruct("Classify the result", {
        status: z.enum(["success", "partial", "fail"]),
        kind: z.literal("foo"),
        tags: z.array(z.enum(["a", "b", "c"])),
      });
      const compiled = instruct.render();

      const exampleMatch = compiled.match(/Example:\n([\s\S]*?)\n\nClassify the result/);
      expect(exampleMatch?.[1]).toBeDefined();
      expect(JSON.parse(exampleMatch![1])).toEqual({
        status: "success",
        kind: "foo",
        tags: ["a"],
      });
    });
  });
});
