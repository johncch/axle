import { describe, expect, test } from "@jest/globals";
import { Chat, getFiles, getTextContent } from "../../src/messages/chat.js";
import { FileInfo } from "../../src/utils/file.js";

describe("Multimodal Support", () => {
  const mockImageFile: FileInfo = {
    path: "/test/image.jpg",
    base64:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    mimeType: "image/jpeg",
    size: 1000,
    name: "image.jpg",
    type: "image",
  };

  const mockPdfFile: FileInfo = {
    path: "/test/document.pdf",
    base64:
      "JVBERi0xLjQKJdPr6eEKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKL01lZGlhQm94IFswIDAgNTk1IDg0Ml0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UK",
    mimeType: "application/pdf",
    size: 2000,
    name: "document.pdf",
    type: "document",
  };

  describe("Chat Integration", () => {
    test("multimodal content structure is preserved", () => {
      const chat = new Chat();
      chat.addUser("Analyze these files", [mockImageFile, mockPdfFile]);

      expect(chat.messages).toHaveLength(1);
      const message = chat.messages[0];
      expect(Array.isArray(message.content)).toBe(true);

      const content = message.content as any[];
      expect(content).toHaveLength(3);
      expect(content[0].type).toBe("text");
      expect(content[0].text).toBe("Analyze these files");
      expect(content[1].type).toBe("file");
      expect(content[1].file).toBe(mockImageFile);
      expect(content[2].type).toBe("file");
      expect(content[2].file).toBe(mockPdfFile);
    });

    test("helper methods work with multimodal content", () => {
      const chat = new Chat();
      chat.addUser("Look at this image and PDF", [mockImageFile, mockPdfFile]);

      const message = chat.messages[0];
      expect(message.role).toBe("user");
      const text = getTextContent(message.content as any);
      const files = getFiles(message.content as any);

      expect(text).toBe("Look at this image and PDF");
      expect(files).toHaveLength(2);
      expect(files[0]).toBe(mockImageFile);
      expect(files[1]).toBe(mockPdfFile);
    });

    test("mixed content types are handled correctly", () => {
      const chat = new Chat();
      chat.addUser("Text only message");
      chat.addUser("Message with image", [mockImageFile]);

      expect(chat.messages).toHaveLength(2);
      expect(typeof chat.messages[0].content).toBe("string");
      expect(Array.isArray(chat.messages[1].content)).toBe(true);
    });

    test("empty file arrays behave like text-only messages", () => {
      const chat = new Chat();
      chat.addUser("Hello", []);

      expect(typeof chat.messages[0].content).toBe("string");
      expect(chat.messages[0].content).toBe("Hello");
    });
  });
});
