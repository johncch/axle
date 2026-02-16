import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, test } from "vitest";
import {
  getEncodingForFile,
  loadFileContent,
  pathToComponents,
  replaceFilePattern,
} from "../../src/utils/file.js";

const TEST_DIR = join(process.cwd(), "test-temp", "file-test");

describe("file module", () => {
  describe("path to components", () => {
    test("splits file path into components", () => {
      const input = "input/file.json";
      const output = pathToComponents(input);
      expect(output).toEqual({
        abs: input,
        dir: "input/",
        name: "file.json",
        stem: "file",
        ext: ".json",
      });
    });
  });

  describe("replace file pattern", () => {
    test("replaces ** with file path", () => {
      const input = "output/**";
      const pathComponents = pathToComponents("input/file.json");
      const output = replaceFilePattern(input, pathComponents);
      expect(output).toBe("output/input/file.json");
    });

    test("replaces **.txt with file path", () => {
      const input = "output/**.txt";
      const pathComponents = pathToComponents("input/file.json");
      const output = replaceFilePattern(input, pathComponents);
      expect(output).toBe("output/input/file.txt");
    });

    test("replaces **/* with file path", () => {
      const input = "output/**/*";
      const pathComponents = pathToComponents("input/file.json");
      const output = replaceFilePattern(input, pathComponents);
      expect(output).toBe("output/input/file.json");
    });

    test("replaces **/*.txt with file path", () => {
      const input = "output/**/*.txt";
      const pathComponents = pathToComponents("input/file.json");
      const output = replaceFilePattern(input, pathComponents);
      expect(output).toBe("output/input/file.txt");
    });

    test("replaces * with file path", () => {
      const input = "output/*";
      const pathComponents = pathToComponents("input/file.json");
      const output = replaceFilePattern(input, pathComponents);
      expect(output).toBe("output/file.json");
    });

    test("replaces *.txt with file path", () => {
      const input = "output/*.txt";
      const pathComponents = pathToComponents("input/file.json");
      const output = replaceFilePattern(input, pathComponents);
      expect(output).toBe("output/file.txt");
    });

    test("does not replace if no * provided", () => {
      const input = "output/test.txt";
      const pathComponents = pathToComponents("input/file.json");
      const output = replaceFilePattern(input, pathComponents);
      expect(output).toBe("output/test.txt");
    });

    test("throws an error if bad path", () => {
      // TODO
    });
  });

  describe("getEncodingForFile", () => {
    describe("text file detection", () => {
      it("should detect .txt files as utf-8", () => {
        expect(getEncodingForFile("document.txt")).toBe("utf-8");
        expect(getEncodingForFile("/path/to/file.txt")).toBe("utf-8");
        expect(getEncodingForFile("./relative/path.txt")).toBe("utf-8");
      });

      it("should detect .md files as utf-8", () => {
        expect(getEncodingForFile("README.md")).toBe("utf-8");
        expect(getEncodingForFile("/docs/guide.md")).toBe("utf-8");
        expect(getEncodingForFile("./notes.md")).toBe("utf-8");
      });

      it("should detect .markdown files as utf-8", () => {
        expect(getEncodingForFile("document.markdown")).toBe("utf-8");
        expect(getEncodingForFile("/path/to/file.markdown")).toBe("utf-8");
        expect(getEncodingForFile("./relative/path.markdown")).toBe("utf-8");
      });

      it("should handle case-insensitive text extensions", () => {
        expect(getEncodingForFile("document.TXT")).toBe("utf-8");
        expect(getEncodingForFile("README.MD")).toBe("utf-8");
        expect(getEncodingForFile("file.MARKDOWN")).toBe("utf-8");
        expect(getEncodingForFile("mixed.Txt")).toBe("utf-8");
        expect(getEncodingForFile("mixed.Md")).toBe("utf-8");
      });
    });

    describe("image file detection", () => {
      it("should detect common image formats as base64", () => {
        const imageFormats = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff"];

        imageFormats.forEach((ext) => {
          expect(getEncodingForFile(`image${ext}`)).toBe("base64");
          expect(getEncodingForFile(`/path/to/image${ext}`)).toBe("base64");
          expect(getEncodingForFile(`./relative/image${ext}`)).toBe("base64");
        });
      });

      it("should handle case-insensitive image extensions", () => {
        expect(getEncodingForFile("photo.JPG")).toBe("base64");
        expect(getEncodingForFile("image.PNG")).toBe("base64");
        expect(getEncodingForFile("graphic.GIF")).toBe("base64");
        expect(getEncodingForFile("picture.JPEG")).toBe("base64");
        expect(getEncodingForFile("mixed.Png")).toBe("base64");
      });
    });

    describe("document file detection", () => {
      it("should detect PDF files as base64", () => {
        expect(getEncodingForFile("document.pdf")).toBe("base64");
        expect(getEncodingForFile("/path/to/file.pdf")).toBe("base64");
        expect(getEncodingForFile("./relative/document.pdf")).toBe("base64");
      });

      it("should handle case-insensitive PDF extension", () => {
        expect(getEncodingForFile("document.PDF")).toBe("base64");
        expect(getEncodingForFile("file.Pdf")).toBe("base64");
      });
    });

    describe("mime-based file type detection", () => {
      it("should detect text-like files as utf-8", () => {
        expect(getEncodingForFile("script.js")).toBe("utf-8");
        expect(getEncodingForFile("style.css")).toBe("utf-8");
        expect(getEncodingForFile("data.json")).toBe("utf-8");
        expect(getEncodingForFile("config.yml")).toBe("utf-8");
        expect(getEncodingForFile("data.csv")).toBe("utf-8");
      });

      it("should detect svg as image (base64)", () => {
        expect(getEncodingForFile("./src/components/icons/arrow.svg")).toBe("base64");
      });

      it("should throw for unsupported binary types", () => {
        expect(() => getEncodingForFile("video.mp4")).toThrow("Unsupported file type");
        expect(() => getEncodingForFile("audio.mp3")).toThrow("Unsupported file type");
        expect(() => getEncodingForFile("archive.zip")).toThrow("Unsupported file type");
      });
    });

    describe("unsupported file types", () => {
      it("should throw error for files without extensions", () => {
        expect(() => getEncodingForFile("README")).toThrow();
        expect(() => getEncodingForFile("/path/to/file")).toThrow();
      });

      it("should handle empty extensions", () => {
        expect(() => getEncodingForFile("file.")).toThrow();
      });

      it("should handle files with multiple dots", () => {
        expect(getEncodingForFile("file.backup.txt")).toBe("utf-8");
        expect(getEncodingForFile("image.version.2.png")).toBe("base64");
        expect(getEncodingForFile("document.final.pdf")).toBe("base64");
      });
    });

    describe("edge cases", () => {
      it("should handle absolute paths", () => {
        expect(getEncodingForFile("/usr/local/bin/readme.md")).toBe("utf-8");
        expect(getEncodingForFile("/home/user/images/photo.jpg")).toBe("base64");
      });

      it("should handle relative paths", () => {
        expect(getEncodingForFile("../docs/guide.txt")).toBe("utf-8");
        expect(getEncodingForFile("../../assets/logo.png")).toBe("base64");
      });

      it("should handle Windows-style paths", () => {
        expect(getEncodingForFile("C:\\Documents\\readme.txt")).toBe("utf-8");
        expect(getEncodingForFile("D:\\Photos\\vacation.jpg")).toBe("base64");
      });

      it("should handle paths with special characters", () => {
        expect(getEncodingForFile("file with spaces.md")).toBe("utf-8");
        expect(getEncodingForFile("file-with-dashes.png")).toBe("base64");
        expect(getEncodingForFile("file_with_underscores.txt")).toBe("utf-8");
        expect(getEncodingForFile("file (1).pdf")).toBe("base64");
      });
    });
  });

  describe("loadFileContent", () => {
    beforeEach(async () => {
      await mkdir(TEST_DIR, { recursive: true });
    });

    afterEach(async () => {
      await rm(TEST_DIR, { recursive: true, force: true });
    });

    it("should load a text file successfully with explicit utf-8 encoding", async () => {
      const testContent = "This is a test text file.";
      const filePath = join(TEST_DIR, "test.txt");
      await writeFile(filePath, testContent);

      const result = await loadFileContent(filePath, "utf-8");

      expect(result.content).toBe(testContent);
      expect(result.type).toBe("text");
      expect(result.mimeType).toBe("text/plain");
      expect(result.name).toBe("test.txt");
      expect(result.path).toBe(filePath);
      expect(result.size).toBe(testContent.length);
      expect(result.base64).toBeUndefined();
    });

    it("should load a markdown file successfully with explicit utf-8 encoding", async () => {
      const testContent = "# Test Markdown\n\nThis is a **test** markdown file.";
      const filePath = join(TEST_DIR, "test.md");
      await writeFile(filePath, testContent);

      const result = await loadFileContent(filePath, "utf-8");

      expect(result.content).toBe(testContent);
      expect(result.type).toBe("text");
      expect(result.mimeType).toBe("text/markdown");
      expect(result.name).toBe("test.md");
      expect(result.path).toBe(filePath);
      expect(result.size).toBe(testContent.length);
    });

    it("should handle .markdown extension with explicit utf-8 encoding", async () => {
      const testContent = "# Test\nMarkdown content";
      const filePath = join(TEST_DIR, "test.markdown");
      await writeFile(filePath, testContent);

      const result = await loadFileContent(filePath, "utf-8");

      expect(result.content).toBe(testContent);
      expect(result.mimeType).toBe("text/markdown");
      expect(result.name).toBe("test.markdown");
    });

    it("should throw error for non-existent file", async () => {
      const filePath = join(TEST_DIR, "nonexistent.txt");

      await expect(loadFileContent(filePath, "utf-8")).rejects.toThrow(
        `File not found: ${filePath}`,
      );
    });

    it("should load .js files as text with mime detection", async () => {
      const filePath = join(TEST_DIR, "test.js");
      await writeFile(filePath, "console.log('test');");

      const result = await loadFileContent(filePath, "utf-8");
      expect(result.content).toBe("console.log('test');");
      expect(result.type).toBe("text");
      expect(result.mimeType).toBe("text/javascript");
    });

    it("should throw error for file too large", async () => {
      const filePath = join(TEST_DIR, "large.txt");
      // Create a large content string (over 20MB)
      const largeContent = "x".repeat(21 * 1024 * 1024);
      await writeFile(filePath, largeContent);

      await expect(loadFileContent(filePath, "utf-8")).rejects.toThrow(
        /File too large: \d+ bytes\. Maximum allowed: \d+ bytes/,
      );
    });

    it("should handle empty text files", async () => {
      const filePath = join(TEST_DIR, "empty.txt");
      await writeFile(filePath, "");

      const result = await loadFileContent(filePath, "utf-8");

      expect(result.content).toBe("");
      expect(result.type).toBe("text");
      expect(result.size).toBe(0);
    });

    it("should preserve newlines and formatting", async () => {
      const testContent = "Line 1\nLine 2\n\nLine 4\t\tWith tabs";
      const filePath = join(TEST_DIR, "formatted.txt");
      await writeFile(filePath, testContent);

      const result = await loadFileContent(filePath, "utf-8");

      expect(result.content).toBe(testContent);
    });

    it("should load binary files with base64 encoding", async () => {
      const filePath = join(TEST_DIR, "test.png");
      const testBuffer = Buffer.from("fake png data", "utf-8");
      await writeFile(filePath, testBuffer);

      const result = await loadFileContent(filePath, "base64");

      expect(result.base64).toBe(testBuffer.toString("base64"));
      expect(result.type).toBe("image");
      expect(result.mimeType).toBe("image/png");
      expect(result.name).toBe("test.png");
      expect(result.path).toBe(filePath);
      expect(result.content).toBeUndefined();
    });

    it("should enforce encoding validation for mismatched types", async () => {
      const imagePath = join(TEST_DIR, "test.png");
      await writeFile(imagePath, Buffer.from("fake png", "utf-8"));

      await expect(loadFileContent(imagePath, "utf-8")).rejects.toThrow(
        "Cannot read image file as text",
      );

      const textPath = join(TEST_DIR, "test.txt");
      await writeFile(textPath, "text content");

      await expect(loadFileContent(textPath, "base64")).rejects.toThrow(
        "Cannot read text file as binary",
      );
    });

    describe("encoding auto-detection", () => {
      it("should auto-detect text files", async () => {
        const testCases = [
          { file: "test.txt", content: "Plain text" },
          { file: "test.md", content: "# Markdown" },
          { file: "test.markdown", content: "## More markdown" },
        ];

        for (const testCase of testCases) {
          const filePath = join(TEST_DIR, testCase.file);
          await writeFile(filePath, testCase.content);

          const result = await loadFileContent(filePath);

          expect(result.content).toBe(testCase.content);
          expect(result.type).toBe("text");
          expect(result.base64).toBeUndefined();
        }
      });

      it("should auto-detect binary files", async () => {
        const testCases = [
          { file: "test.png", type: "image" },
          { file: "test.jpg", type: "image" },
          { file: "test.pdf", type: "document" },
        ];

        for (const testCase of testCases) {
          const filePath = join(TEST_DIR, testCase.file);
          const testBuffer = Buffer.from(`fake ${testCase.file} data`, "utf-8");
          await writeFile(filePath, testBuffer);

          const result = await loadFileContent(filePath);

          expect(result.base64).toBe(testBuffer.toString("base64"));
          expect(result.type).toBe(testCase.type);
          expect(result.content).toBeUndefined();
        }
      });

      it("should throw error for unsupported file types", async () => {
        const filePath = join(TEST_DIR, "test.unknown");
        await writeFile(filePath, "content");

        await expect(loadFileContent(filePath)).rejects.toThrow("Unsupported file type: .unknown");
      });

      it("should work with files without extensions", async () => {
        const filePath = join(TEST_DIR, "README");
        await writeFile(filePath, "readme content");

        await expect(loadFileContent(filePath)).rejects.toThrow("Unsupported file type:");
      });

      it("should handle case-insensitive extensions", async () => {
        const testCases = [
          { file: "test.TXT", content: "uppercase txt" },
          { file: "test.PNG", data: Buffer.from("fake png", "utf-8") },
          { file: "test.MD", content: "uppercase markdown" },
        ];

        for (const testCase of testCases) {
          const filePath = join(TEST_DIR, testCase.file);

          if ("content" in testCase) {
            await writeFile(filePath, testCase.content);
            const result = await loadFileContent(filePath);
            expect(result.content).toBe(testCase.content);
            expect(result.type).toBe("text");
          } else {
            await writeFile(filePath, testCase.data);
            const result = await loadFileContent(filePath);
            expect(result.base64).toBe(testCase.data.toString("base64"));
            expect(result.type).toBe("image");
          }
        }
      });
    });
  });
});
