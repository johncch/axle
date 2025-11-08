import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Axle } from "../../src/core/Axle.js";

const TEST_DIR = join(process.cwd(), "test-temp");

describe("Axle file loading methods", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("loadFileContent", () => {
    it("should load text files with utf-8 encoding", async () => {
      const textContent = "# Test Document\n\nThis is a test markdown file.";
      const filePath = join(TEST_DIR, "test.md");
      await writeFile(filePath, textContent);

      const result = await Axle.loadFileContent(filePath, "utf-8");

      expect(result.content).toBe(textContent);
      expect(result.type).toBe("text");
      expect(result.mimeType).toBe("text/markdown");
      expect(result.name).toBe("test.md");
      expect(result.base64).toBeUndefined();
    });

    it("should auto-detect text files when encoding is omitted", async () => {
      const textContent =
        "# Auto-detected Document\n\nThis should be loaded as text.";
      const filePath = join(TEST_DIR, "auto.md");
      await writeFile(filePath, textContent);

      const result = await Axle.loadFileContent(filePath);

      expect(result.content).toBe(textContent);
      expect(result.type).toBe("text");
      expect(result.mimeType).toBe("text/markdown");
      expect(result.name).toBe("auto.md");
      expect(result.base64).toBeUndefined();
    });

    it("should auto-detect binary files when encoding is omitted", async () => {
      const filePath = join(TEST_DIR, "auto.png");
      const testBuffer = Buffer.from("fake png data", "utf-8");
      await writeFile(filePath, testBuffer);

      const result = await Axle.loadFileContent(filePath);

      expect(result.base64).toBe(testBuffer.toString("base64"));
      expect(result.type).toBe("image");
      expect(result.mimeType).toBe("image/png");
      expect(result.name).toBe("auto.png");
      expect(result.content).toBeUndefined();
    });

    it("should load binary files with base64 encoding", async () => {
      const filePath = join(TEST_DIR, "test.png");
      const testBuffer = Buffer.from("fake png data", "utf-8");
      await writeFile(filePath, testBuffer);

      const result = await Axle.loadFileContent(filePath, "base64");

      expect(result.base64).toBe(testBuffer.toString("base64"));
      expect(result.type).toBe("image");
      expect(result.mimeType).toBe("image/png");
      expect(result.name).toBe("test.png");
      expect(result.content).toBeUndefined();
    });

    it("should enforce extension validation for utf-8 encoding", async () => {
      const filePath = join(TEST_DIR, "test.png");
      await writeFile(filePath, Buffer.from("fake png", "utf-8"));

      await expect(Axle.loadFileContent(filePath, "utf-8")).rejects.toThrow(
        "Unsupported text file type: .png",
      );
    });

    it("should enforce extension validation for base64 encoding", async () => {
      const filePath = join(TEST_DIR, "test.txt");
      await writeFile(filePath, "text content");

      await expect(Axle.loadFileContent(filePath, "base64")).rejects.toThrow(
        "Unsupported file type: .txt",
      );
    });

    it("should handle file not found errors", async () => {
      const filePath = join(TEST_DIR, "nonexistent.txt");

      await expect(Axle.loadFileContent(filePath, "utf-8")).rejects.toThrow(
        `File not found: ${filePath}`,
      );

      await expect(Axle.loadFileContent(filePath, "base64")).rejects.toThrow(
        `File not found: ${filePath}`,
      );
    });

    it("should handle different text file types", async () => {
      const testCases = [
        { file: "test.txt", content: "Plain text", mimeType: "text/plain" },
        { file: "test.md", content: "# Markdown", mimeType: "text/markdown" },
        {
          file: "test.markdown",
          content: "## More markdown",
          mimeType: "text/markdown",
        },
      ];

      for (const testCase of testCases) {
        const filePath = join(TEST_DIR, testCase.file);
        await writeFile(filePath, testCase.content);

        const result = await Axle.loadFileContent(filePath, "utf-8");

        expect(result.content).toBe(testCase.content);
        expect(result.mimeType).toBe(testCase.mimeType);
        expect(result.type).toBe("text");
      }
    });

    it("should handle different image file types", async () => {
      const imageTypes = [
        { ext: ".jpg", mimeType: "image/jpeg" },
        { ext: ".jpeg", mimeType: "image/jpeg" },
        { ext: ".png", mimeType: "image/png" },
        { ext: ".gif", mimeType: "image/gif" },
        { ext: ".webp", mimeType: "image/webp" },
      ];

      for (const imageType of imageTypes) {
        const filePath = join(TEST_DIR, `test${imageType.ext}`);
        const testBuffer = Buffer.from(`fake ${imageType.ext} data`, "utf-8");
        await writeFile(filePath, testBuffer);

        const result = await Axle.loadFileContent(filePath, "base64");

        expect(result.base64).toBe(testBuffer.toString("base64"));
        expect(result.mimeType).toBe(imageType.mimeType);
        expect(result.type).toBe("image");
      }
    });

    it("should handle PDF files", async () => {
      const filePath = join(TEST_DIR, "test.pdf");
      const testBuffer = Buffer.from("fake pdf data", "utf-8");
      await writeFile(filePath, testBuffer);

      const result = await Axle.loadFileContent(filePath, "base64");

      expect(result.base64).toBe(testBuffer.toString("base64"));
      expect(result.mimeType).toBe("application/pdf");
      expect(result.type).toBe("document");
    });

    it("should auto-detect various file types correctly", async () => {
      const testCases = [
        { file: "test.txt", content: "Plain text", shouldBeText: true },
        { file: "test.md", content: "# Markdown", shouldBeText: true },
        { file: "test.markdown", content: "## Markdown", shouldBeText: true },
        {
          file: "test.jpg",
          data: Buffer.from("fake jpg", "utf-8"),
          shouldBeText: false,
        },
        {
          file: "test.png",
          data: Buffer.from("fake png", "utf-8"),
          shouldBeText: false,
        },
        {
          file: "test.pdf",
          data: Buffer.from("fake pdf", "utf-8"),
          shouldBeText: false,
        },
      ];

      for (const testCase of testCases) {
        const filePath = join(TEST_DIR, testCase.file);

        if (testCase.shouldBeText) {
          await writeFile(filePath, testCase.content!);
          const result = await Axle.loadFileContent(filePath);
          expect(result.content).toBe(testCase.content);
          expect(result.type).toBe("text");
          expect(result.base64).toBeUndefined();
        } else {
          await writeFile(filePath, testCase.data!);
          const result = await Axle.loadFileContent(filePath);
          expect(result.base64).toBe(testCase.data!.toString("base64"));
          expect(result.type).toMatch(/^(image|document)$/);
          expect(result.content).toBeUndefined();
        }
      }
    });

    it("should throw error for unsupported file types in auto-detection", async () => {
      const filePath = join(TEST_DIR, "test.unknown");
      await writeFile(filePath, "some content");

      await expect(Axle.loadFileContent(filePath)).rejects.toThrow(
        "Unsupported file type: .unknown",
      );
    });
  });
});
