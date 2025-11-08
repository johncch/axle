import { describe, expect, test } from "@jest/globals";
import { Instruct } from "../../src/core/Instruct.js";
import { FileInfo } from "../src/utils/file.js";

describe("AbstractInstruct", () => {
  describe("file methods", () => {
    test("addImage accepts image files", () => {
      const instruction = Instruct.with("Test prompt");
      const imageFile: FileInfo = {
        path: "/test/image.jpg",
        base64: "base64data",
        mimeType: "image/jpeg",
        size: 1000,
        name: "image.jpg",
        type: "image",
      };

      instruction.addImage(imageFile);
      expect(instruction.hasFiles()).toBe(true);
      expect(instruction.files).toHaveLength(1);
      expect(instruction.files[0]).toBe(imageFile);
    });

    test("addImage rejects non-image files", () => {
      const instruction = Instruct.with("Test prompt");
      const pdfFile: FileInfo = {
        path: "/test/document.pdf",
        base64: "base64data",
        mimeType: "application/pdf",
        size: 1000,
        name: "document.pdf",
        type: "document",
      };

      expect(() => instruction.addImage(pdfFile)).toThrow(
        "Expected image file, got document"
      );
    });

    test("addFile accepts any file type", () => {
      const instruction = Instruct.with("Test prompt");
      const imageFile: FileInfo = {
        path: "/test/image.jpg",
        base64: "base64data",
        mimeType: "image/jpeg",
        size: 1000,
        name: "image.jpg",
        type: "image",
      };
      const pdfFile: FileInfo = {
        path: "/test/document.pdf",
        base64: "base64data",
        mimeType: "application/pdf",
        size: 1000,
        name: "document.pdf",
        type: "document",
      };

      instruction.addFile(imageFile);
      instruction.addFile(pdfFile);
      expect(instruction.hasFiles()).toBe(true);
      expect(instruction.files).toHaveLength(2);
    });

    test("hasFiles returns false when no files added", () => {
      const instruction = Instruct.with("Test prompt");
      expect(instruction.hasFiles()).toBe(false);
    });

    test("hasFiles returns true when files are added", () => {
      const instruction = Instruct.with("Test prompt");
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
      const instruction = Instruct.with("Test prompt");
      expect(instruction.files).toHaveLength(0);
    });

    test("multiple files can be added", () => {
      const instruction = Instruct.with("Test prompt");
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

      instruction.addImage(file1);
      instruction.addImage(file2);
      expect(instruction.files).toHaveLength(2);
      expect(instruction.files[0]).toBe(file1);
      expect(instruction.files[1]).toBe(file2);
    });
  });
});