import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadFileContent } from "../../src/utils/file.js";
import { Instruct } from "../../src/core/Instruct.js";

const TEST_DIR = join(process.cwd(), "test-temp");

describe("Instruct with text references", () => {
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
    const instruct = Instruct.with("Summarize the text");
    instruct.addReference(textFile, { name: "arxiv paper" });

    const compiled = instruct.compile({});

    expect(compiled.message).toContain("Summarize the text");
    expect(compiled.message).toContain("## Reference 1: arxiv paper");
    expect(compiled.message).toContain(textContent);
  });

  it("should use filename as default reference name", async () => {
    const textContent =
      "# Important Document\n\nThis contains important information.";
    const filePath = join(TEST_DIR, "document.md");
    await writeFile(filePath, textContent);

    const textFile = await loadFileContent(filePath, "utf-8");
    const instruct = Instruct.with("What does this document say?");
    instruct.addReference(textFile);

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

    const instruct = Instruct.with("Compare these papers");
    instruct.addReference(textFile1, { name: "Paper A" });
    instruct.addReference(textFile2, { name: "Paper B" });

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
    const instruct = Instruct.with(
      "Analyze the {{analysis_type}} in this document",
    );
    instruct.addReference(textFile, { name: "Reference Doc" });

    const compiled = instruct.compile({
      topic: "artificial intelligence",
      analysis_type: "methodology",
    });

    expect(compiled.message).toContain(
      "Analyze the methodology in this document",
    );
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
    const instruct = Instruct.with("Process this markdown");
    instruct.addReference(textFile, { name: "Markdown Doc" });

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
    const instruct = Instruct.with("What is in this file?");
    instruct.addReference(textFile, { name: "Empty File" });

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
    const instruct = Instruct.with("Extract information", {
      score: "number",
      summary: "string",
    });
    instruct.addReference(textFile, { name: "Score Data" });

    const compiled = instruct.compile({});

    expect(compiled.message).toContain("Extract information");
    expect(compiled.message).toContain("## Reference 1: Score Data");
    expect(compiled.message).toContain(textContent);
    expect(compiled.instructions).toContain("<score></score>");
    expect(compiled.instructions).toContain("<summary></summary>");
  });
});
