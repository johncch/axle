import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, test } from "vitest";
import * as z from "zod";
import { Instruct } from "../../src/core/Instruct.js";
import { AxleInstructVariableError } from "../../src/errors/AxleInstructVariableError.js";
import { FileInfo, loadFileContent } from "../../src/utils/file.js";

const TEST_DIR = join(process.cwd(), "test-temp", "instruct-test");

describe("Instruct", () => {
  describe("message boundary", () => {
    test("validates required inputs", () => {
      const instruct = new Instruct({ prompt: "Review {{target}}" });

      expect(() => instruct.validate()).toThrow(AxleInstructVariableError);
      expect(instruct.validate({ vars: "optional" })).toBeUndefined();
      expect(instruct.withInput("target", "this diff").validate()).toBeUndefined();
    });

    test("render validates with its effective variable mode", () => {
      const instruct = new Instruct({
        prompt: "Review {{target}}",
        vars: "optional",
      });

      expect(instruct.render()).toBe("Review {{target}}");
      expect(() => instruct.render({ vars: "required" })).toThrow(AxleInstructVariableError);
    });

    test("creates a user message from the rendered instruction", () => {
      const instruct = new Instruct({
        prompt: "Review {{target}}",
        metadata: { source: "instruct" },
      }).withInput("target", "this diff");

      const message = instruct.toMessage();

      expect(message).toMatchObject({
        role: "user",
        content: [{ type: "text", text: "Review this diff" }],
        metadata: { source: "instruct" },
      });
      expect(message.id).toBeTypeOf("string");
    });

    test("parses the assistant response with its schema", async () => {
      const instruct = new Instruct({
        prompt: "Return a result",
        schema: z.object({ answer: z.string() }),
      });

      expect(
        await instruct.parse({
          role: "assistant",
          id: "response-1",
          content: [{ type: "text", text: '{"answer":"yes"}' }],
        }),
      ).toEqual({ answer: "yes" });
      expect(await instruct.parse(undefined)).toBeNull();
    });

    test("parses a response the provider split across several text parts", async () => {
      const instruct = new Instruct({
        prompt: "Return a result",
        schema: z.object({ answer: z.string() }),
      });

      expect(
        await instruct.parse({
          role: "assistant",
          id: "response-1",
          content: [
            { type: "text", text: '{"answer":"The article reflects ' },
            { type: "text", text: "on a design theory." },
            { type: "text", text: '"}' },
          ],
        }),
      ).toEqual({ answer: "The article reflects on a design theory." });
    });
  });

  describe("input binding", () => {
    test("withInputs returns a new instruct without mutating the original", () => {
      const template = new Instruct({ prompt: "Hello {{name}}" });
      const bound = template.withInputs({ name: "Alice" });

      expect(template).not.toBe(bound);
      expect(template.inputs).toEqual({});
      expect(bound.inputs).toEqual({ name: "Alice" });
      expect(bound.render()).toBe("Hello Alice");
    });

    test("withInput merges into existing inputs on a cloned instruct", () => {
      const template = new Instruct({ prompt: "Hello {{title}} {{name}}" }).withInputs({
        title: "Dr.",
      });
      const bound = template.withInput("name", "Rivera");

      expect(template).not.toBe(bound);
      expect(template.inputs).toEqual({ title: "Dr." });
      expect(bound.inputs).toEqual({ title: "Dr.", name: "Rivera" });
      expect(bound.render()).toBe("Hello Dr. Rivera");
    });

    test("render throws when an input is missing", () => {
      const template = new Instruct({ prompt: "Hello {{name}} from {{place}}" }).withInput(
        "name",
        "Alice",
      );

      expect(() => template.render()).toThrow(/Missing variable: place/);
    });

    test("render throws a typed error when inputs are missing", () => {
      const template = new Instruct({ prompt: "Hello {{name}} from {{place}}" });

      try {
        template.render();
        throw new Error("Expected render to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(AxleInstructVariableError);
        expect((error as AxleInstructVariableError).missingVariables).toEqual(["name", "place"]);
        expect((error as AxleInstructVariableError).code).toBe("INSTRUCT_VARIABLE_ERROR");
      }
    });

    test("render can leave missing variables unresolved", () => {
      const template = new Instruct({ prompt: "Hello {{name}} from {{place}}" }).withInput(
        "name",
        "Alice",
      );

      expect(template.render({ vars: "optional" })).toBe("Hello Alice from {{place}}");
    });

    test("vars option is preserved when cloning", () => {
      const template = new Instruct({
        prompt: "Describe a {{breed}}",
        vars: "optional",
      }).withInput("name", "Riley");

      expect(template.render()).toBe("Describe a {{breed}}");
      expect(template.vars).toBe("optional");
    });
  });

  describe("file methods", () => {
    test("addFile accepts image files", () => {
      const instruction = new Instruct({ prompt: "Test prompt" });
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
      const instruction = new Instruct({ prompt: "Test prompt" });
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
      const instruction = new Instruct({ prompt: "Test prompt" });
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
      const instruction = new Instruct({ prompt: "Test prompt" });
      instruction.addFile("some content", { name: "my ref" });
      expect(instruction.textReferences).toHaveLength(1);
      expect(instruction.textReferences[0].content).toBe("some content");
      expect(instruction.textReferences[0].name).toBe("my ref");
    });

    test("hasFiles returns false when no files added", () => {
      const instruction = new Instruct({ prompt: "Test prompt" });
      expect(instruction.hasFiles()).toBe(false);
    });

    test("hasFiles returns true when files are added", () => {
      const instruction = new Instruct({ prompt: "Test prompt" });
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
      const instruction = new Instruct({ prompt: "Test prompt" });
      expect(instruction.files).toHaveLength(0);
    });

    test("multiple files can be added", () => {
      const instruction = new Instruct({ prompt: "Test prompt" });
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

  describe("context sections", () => {
    test("addContext stores supporting context separately and is chainable", () => {
      const instruct = new Instruct({ prompt: "Review the sandbox" });

      const result = instruct.addContext("src/index.ts\npackage.json", {
        title: "Sandbox files",
      });

      expect(result).toBe(instruct);
      expect(instruct.prompt).toBe("Review the sandbox");
      expect(instruct.contextSections).toEqual([
        {
          content: "src/index.ts\npackage.json",
          title: "Sandbox files",
        },
      ]);
    });

    test("render appends context sections in insertion order without replacing variables", () => {
      const instruct = new Instruct({ prompt: "Inspect {{target}}" }).withInput(
        "target",
        "the project",
      );
      instruct.addContext("First context with {{literal}}", { title: "Manifest" });
      instruct.addContext("Second context");

      expect(instruct.render()).toBe(
        "Inspect the project" +
          "\n\n## Context 1: Manifest\n\n```\nFirst context with {{literal}}\n```" +
          "\n\n## Context 2\n\n```\nSecond context\n```",
      );
    });

    test("clone and withInputs preserve independent context sections", () => {
      const template = new Instruct({ prompt: "Inspect {{target}}" });
      template.addContext("original", { title: "Environment" });

      const bound = template.withInput("target", "workspace");
      bound.addContext("bound only");

      expect(template.contextSections).toEqual([{ content: "original", title: "Environment" }]);
      expect(bound.contextSections).toEqual([
        { content: "original", title: "Environment" },
        { content: "bound only" },
      ]);
    });

    test("uses a longer matching fence for context containing backticks", () => {
      const content = "Files:\n```text\nsrc/index.ts\n```";
      const instruct = new Instruct({ prompt: "Inspect" }).addContext(content, {
        title: "Manifest",
      });

      expect(instruct.render()).toContain(
        `## Context 1: Manifest\n\n\`\`\`\`\n${content}\n\`\`\`\``,
      );
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
      const instruct = new Instruct({ prompt: "Summarize the text" });
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
      const instruct = new Instruct({ prompt: "What does this document say?" });
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

      const instruct = new Instruct({ prompt: "Compare these papers" });
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
      const instruct = new Instruct({
        prompt: "Analyze the {{analysis_type}} in this document",
      }).withInputs({
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
      const instruct = new Instruct({ prompt: "Process this markdown" });
      instruct.addFile(textFile, { name: "Markdown Doc" });

      const compiled = instruct.render();

      expect(compiled).toContain("## Reference 1: Markdown Doc");
      expect(compiled).toContain("# Title");
      expect(compiled).toContain("**Bold text**");
      expect(compiled).toContain("```javascript");
    });

    it("uses a longer matching fence when reference content contains backticks", () => {
      const content = "Before\n```ts\nconst answer = 42;\n```\nAfter";
      const instruct = new Instruct({ prompt: "Process this reference" });
      instruct.addFile(content, { name: "code sample" });

      expect(instruct.render()).toContain(
        `## Reference 1: code sample\n\n\`\`\`\`\n${content}\n\`\`\`\``,
      );
    });

    it("should handle empty text files", async () => {
      const filePath = join(TEST_DIR, "empty.txt");
      await writeFile(filePath, "");

      const textFile = await loadFileContent(filePath, "utf-8");
      const instruct = new Instruct({ prompt: "What is in this file?" });
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
      const instruct = new Instruct({
        prompt: "Extract information",
        schema: z.object({
          score: z.number(),
          summary: z.string(),
        }),
      });
      instruct.addFile(textFile, { name: "Score Data" });

      const compiled = instruct.render();

      expect(compiled).toContain("Extract information");
      expect(compiled).toContain("## Reference 1: Score Data");
      expect(compiled).toContain(textContent);
      expect(compiled).not.toContain("Output Format Instructions");
    });
  });

  describe("optional schema", () => {
    it("should create instruct without schema", () => {
      const instruct = new Instruct({ prompt: "Hello world" });
      expect(instruct.schema).toBeUndefined();
    });

    it("emits message untouched when no schema is set", () => {
      const instruct = new Instruct({ prompt: "Hello world" });
      const compiled = instruct.render();
      expect(compiled).toBe("Hello world");
    });

    it("renders the prompt without the schema", () => {
      const instruct = new Instruct({
        prompt: "Hello world",
        schema: z.object({ answer: z.string() }),
      });

      expect(instruct.render()).toBe("Hello world");
    });

    it("puts a Standard Schema on the message as its JSON Schema", () => {
      const schema = z.object({ answer: z.string() });
      const message = new Instruct({ prompt: "Hello world", schema }).toMessage();

      expect(message.content).toEqual([{ type: "text", text: "Hello world" }]);
      expect(message.output).toEqual({ schema: z.toJSONSchema(schema, { io: "input" }) });
    });

    it("puts a JSON Schema object on the message as written", () => {
      const schema = {
        type: "object",
        properties: { status: { enum: ["success", "fail"] } },
        required: ["status"],
      };
      const message = new Instruct({ prompt: "Classify the run", schema }).toMessage();

      expect(message.output?.schema).toBe(schema);
    });

    it("puts no output on a message without a schema", () => {
      expect(new Instruct({ prompt: "Hello world" }).toMessage()).not.toHaveProperty("output");
    });

    it("accepts schemas the example builder used to reject", () => {
      const instruct = new Instruct({
        prompt: "Describe the event",
        schema: z.object({
          nickname: z.string().nullable(),
          at: z.iso.datetime().optional(),
          value: z.union([z.string(), z.number()]),
        }),
      });

      expect(() => instruct.validate()).not.toThrow();
    });

    it("accepts a root that is not an object", () => {
      const message = new Instruct({
        prompt: "Return the fixed status",
        schema: z.literal("approved"),
      }).toMessage();

      expect(message.output?.schema).toMatchObject({ const: "approved" });
    });

    it("throws the library's conversion error when validated", () => {
      const instruct = new Instruct({ prompt: "When?", schema: z.object({ at: z.date() }) });

      expect(() => instruct.validate()).toThrow("Date cannot be represented in JSON Schema");
    });
  });
});
