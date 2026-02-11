import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, test } from "vitest";
import * as z from "zod";
import { Instruct } from "../../src/core/Instruct.js";
import { FileInfo, loadFileContent } from "../../src/utils/file.js";

const TEST_DIR = join(process.cwd(), "test-temp", "instruct-test");

describe("Instruct", () => {
  describe("file methods", () => {
    test("addFile accepts image files", () => {
      const instruction = new Instruct("Test prompt");
      const imageFile: FileInfo = {
        path: "/test/image.jpg",
        base64: "base64data",
        mimeType: "image/jpeg",
        size: 1000,
        name: "image.jpg",
        type: "image",
      };

      instruction.addFile(imageFile);
      expect(instruction.hasFiles()).toBe(true);
      expect(instruction.files).toHaveLength(1);
      expect(instruction.files[0]).toBe(imageFile);
    });

    test("addFile accepts document files", () => {
      const instruction = new Instruct("Test prompt");
      const pdfFile: FileInfo = {
        path: "/test/document.pdf",
        base64: "base64data",
        mimeType: "application/pdf",
        size: 1000,
        name: "document.pdf",
        type: "document",
      };

      instruction.addFile(pdfFile);
      expect(instruction.hasFiles()).toBe(true);
      expect(instruction.files).toHaveLength(1);
    });

    test("addFile accepts text files as references", () => {
      const instruction = new Instruct("Test prompt");
      const textFile: FileInfo = {
        path: "/test/file.txt",
        content: "hello world",
        mimeType: "text/plain",
        size: 11,
        name: "file.txt",
        type: "text",
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
        path: "/test/image.jpg",
        base64: "base64data",
        mimeType: "image/jpeg",
        size: 1000,
        name: "image.jpg",
        type: "image",
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
        path: "/test/image1.jpg",
        base64: "base64data1",
        mimeType: "image/jpeg",
        size: 1000,
        name: "image1.jpg",
        type: "image",
      };
      const file2: FileInfo = {
        path: "/test/image2.png",
        base64: "base64data2",
        mimeType: "image/png",
        size: 2000,
        name: "image2.png",
        type: "image",
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

      const compiled = instruct.compile({});

      expect(compiled.message).toContain("Summarize the text");
      expect(compiled.message).toContain("## Reference 1: arxiv paper");
      expect(compiled.message).toContain(textContent);
    });

    it("should use filename as default reference name", async () => {
      const textContent = "# Important Document\n\nThis contains important information.";
      const filePath = join(TEST_DIR, "document.md");
      await writeFile(filePath, textContent);

      const textFile = await loadFileContent(filePath, "utf-8");
      const instruct = new Instruct("What does this document say?");
      instruct.addFile(textFile);

      const compiled = instruct.compile({});

      expect(compiled.message).toContain("What does this document say?");
      expect(compiled.message).toContain("## Reference 1: document.md");
      expect(compiled.message).toContain(textContent);
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

      const compiled = instruct.compile({});

      expect(compiled.message).toContain("Compare these papers");
      expect(compiled.message).toContain("## Reference 1: Paper A");
      expect(compiled.message).toContain(paper1Content);
      expect(compiled.message).toContain("## Reference 2: Paper B");
      expect(compiled.message).toContain(paper2Content);
    });

    it("should work with variable replacement in main prompt", async () => {
      const textContent = "Document about {{topic}}.";
      const filePath = join(TEST_DIR, "template.txt");
      await writeFile(filePath, textContent);

      const textFile = await loadFileContent(filePath, "utf-8");
      const instruct = new Instruct("Analyze the {{analysis_type}} in this document");
      instruct.addFile(textFile, { name: "Reference Doc" });

      const compiled = instruct.compile({
        topic: "artificial intelligence",
        analysis_type: "methodology",
      });

      expect(compiled.message).toContain("Analyze the methodology in this document");
      expect(compiled.message).toContain("## Reference 1: Reference Doc");
      expect(compiled.message).toContain("Document about {{topic}}.");
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

      const compiled = instruct.compile({});

      expect(compiled.message).toContain("## Reference 1: Markdown Doc");
      expect(compiled.message).toContain("# Title");
      expect(compiled.message).toContain("**Bold text**");
      expect(compiled.message).toContain("```javascript");
    });

    it("should handle empty text files", async () => {
      const filePath = join(TEST_DIR, "empty.txt");
      await writeFile(filePath, "");

      const textFile = await loadFileContent(filePath, "utf-8");
      const instruct = new Instruct("What is in this file?");
      instruct.addFile(textFile, { name: "Empty File" });

      const compiled = instruct.compile({});

      expect(compiled.message).toContain("What is in this file?");
      expect(compiled.message).toContain("## Reference 1: Empty File");
      expect(compiled.message).toMatch(/## Reference 1: Empty File\s*\n\s*\n/);
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

      const compiled = instruct.compile({});

      expect(compiled.message).toContain("Extract information");
      expect(compiled.message).toContain("## Reference 1: Score Data");
      expect(compiled.message).toContain(textContent);
      expect(compiled.instructions).toContain("<score></score>");
      expect(compiled.instructions).toContain("<summary></summary>");
    });
  });

  describe("optional schema", () => {
    it("should create instruct without schema", () => {
      const instruct = new Instruct("Hello world");
      expect(instruct.schema).toBeUndefined();
    });

    it("should skip output format instructions when no schema", () => {
      const instruct = new Instruct("Hello world");
      const compiled = instruct.compile({});
      expect(compiled.instructions).not.toContain("Output Format Instructions");
    });

    it("should include output format instructions when schema provided", () => {
      const instruct = new Instruct("Hello world", { answer: z.string() });
      const compiled = instruct.compile({});
      expect(compiled.instructions).toContain("Output Format Instructions");
      expect(compiled.instructions).toContain("<answer></answer>");
    });
  });
});
