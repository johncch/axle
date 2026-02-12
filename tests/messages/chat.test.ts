import { describe, expect, test } from "vitest";
import { History } from "../../src/messages/history.js";
import { ContentPartFile, ContentPartText } from "../../src/messages/types.js";
import { getFiles, getTextContent } from "../../src/messages/utils.js";
import { FileInfo } from "../../src/utils/file.js";

describe("History", () => {
  describe("basic functionality", () => {
    test("addUser with string content", () => {
      const chat = new History();
      chat.addUser("Hello");

      expect(chat.messages).toHaveLength(1);
      expect(chat.messages[0].role).toBe("user");
      expect(Array.isArray(chat.messages[0].content)).toBe(true);

      const content = chat.messages[0].content as ContentPartText[];
      expect(content).toHaveLength(1);
      expect(content[0].type).toBe("text");
      expect(content[0].text).toBe("Hello");
    });

    test("addUser with ContentPart array", () => {
      const chat = new History();
      const content: ContentPartText[] = [
        { type: "text", text: "Hello" },
        { type: "text", text: "World" },
      ];

      chat.addUser(content);

      expect(chat.messages).toHaveLength(1);
      expect(chat.messages[0].role).toBe("user");
      expect(chat.messages[0].content).toEqual(content);
    });

    test("addSystem sets system message", () => {
      const chat = new History();
      chat.addSystem("You are a helpful assistant");

      expect(chat.system).toBe("You are a helpful assistant");
    });
  });

  describe("multimodal functionality", () => {
    const mockImageFile: FileInfo = {
      path: "/test/image.jpg",
      base64: "base64data",
      mimeType: "image/jpeg",
      size: 1000,
      name: "image.jpg",
      type: "image",
    };

    const mockPdfFile: FileInfo = {
      path: "/test/document.pdf",
      base64: "base64data",
      mimeType: "application/pdf",
      size: 2000,
      name: "document.pdf",
      type: "document",
    };

    test("addUser with text and files", () => {
      const chat = new History();
      const content: Array<ContentPartText | ContentPartFile> = [
        { type: "text", text: "Analyze this image" },
        { type: "file", file: mockImageFile },
      ];

      chat.addUser(content);

      expect(chat.messages).toHaveLength(1);
      expect(chat.messages[0].role).toBe("user");

      const msgContent = chat.messages[0].content as Array<ContentPartText | ContentPartFile>;
      expect(msgContent).toHaveLength(2);
      expect(msgContent[0].type).toBe("text");
      expect((msgContent[0] as ContentPartText).text).toBe("Analyze this image");
      expect(msgContent[1].type).toBe("file");
      expect((msgContent[1] as ContentPartFile).file).toBe(mockImageFile);
    });

    test("addUser with multiple files", () => {
      const chat = new History();
      const content: Array<ContentPartText | ContentPartFile> = [
        { type: "text", text: "Analyze these files" },
        { type: "file", file: mockImageFile },
        { type: "file", file: mockPdfFile },
      ];

      chat.addUser(content);

      expect(chat.messages).toHaveLength(1);
      const msgContent = chat.messages[0].content as Array<ContentPartText | ContentPartFile>;
      expect(msgContent).toHaveLength(3);
      expect(msgContent[0].type).toBe("text");
      expect(msgContent[1].type).toBe("file");
      expect((msgContent[1] as ContentPartFile).file).toBe(mockImageFile);
      expect(msgContent[2].type).toBe("file");
      expect((msgContent[2] as ContentPartFile).file).toBe(mockPdfFile);
    });
  });

  describe("helper methods", () => {
    const imageFile: FileInfo = {
      path: "/test/image.jpg",
      base64: "base64data",
      mimeType: "image/jpeg",
      size: 1000,
      name: "image.jpg",
      type: "image",
    };

    test("getTextContent extracts text from ContentPart array", () => {
      const content: ContentPartText[] = [
        { type: "text", text: "Hello" },
        { type: "text", text: "world" },
      ];

      const text = getTextContent(content);
      expect(text).toBe("Hello\n\nworld");
    });

    test("getFiles extracts files from multimodal content", () => {
      const content: Array<ContentPartText | ContentPartFile> = [
        { type: "text", text: "Hello" },
        { type: "file", file: imageFile },
      ];

      const files = getFiles(content);
      expect(files).toHaveLength(1);
      expect(files[0]).toBe(imageFile);
    });

    test("getFiles with multiple files", () => {
      const documentFile: FileInfo = {
        path: "/test/document.pdf",
        base64: "base64data",
        mimeType: "application/pdf",
        size: 2000,
        name: "document.pdf",
        type: "document",
      };

      const content: Array<ContentPartText | ContentPartFile> = [
        { type: "text", text: "Hello" },
        { type: "file", file: imageFile },
        { type: "file", file: documentFile },
      ];

      const files = getFiles(content);
      expect(files).toHaveLength(2);
      expect(files[0]).toBe(imageFile);
      expect(files[1]).toBe(documentFile);
    });
  });

  describe("toString", () => {
    test("serializes conversation to JSON string", () => {
      const chat = new History();
      chat.addSystem("System message");
      chat.addUser("User message");

      const result = chat.toString();
      const parsed = JSON.parse(result);

      expect(parsed.system).toBe("System message");
      expect(parsed.messages).toHaveLength(1);
    });
  });
});
