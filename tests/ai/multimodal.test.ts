import { describe, expect, test } from "@jest/globals";
import { Conversation } from "../../src/messages/conversation.js";
import { ContentPartFile, ContentPartText } from "../../src/messages/types.js";
import { getFiles, getTextContent } from "../../src/messages/utils.js";
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

  describe("Conversation Integration", () => {
    test("multimodal content structure is preserved", () => {
      const chat = new Conversation();
      const content: Array<ContentPartText | ContentPartFile> = [
        { type: "text", text: "Analyze these files" },
        { type: "file", file: mockImageFile },
        { type: "file", file: mockPdfFile },
      ];

      chat.addUser(content);

      expect(chat.messages).toHaveLength(1);
      const message = chat.messages[0];
      expect(Array.isArray(message.content)).toBe(true);

      const msgContent = message.content as Array<ContentPartText | ContentPartFile>;
      expect(msgContent).toHaveLength(3);
      expect(msgContent[0].type).toBe("text");
      expect((msgContent[0] as ContentPartText).text).toBe("Analyze these files");
      expect(msgContent[1].type).toBe("file");
      expect((msgContent[1] as ContentPartFile).file).toBe(mockImageFile);
      expect(msgContent[2].type).toBe("file");
      expect((msgContent[2] as ContentPartFile).file).toBe(mockPdfFile);
    });

    test("helper methods work with multimodal content", () => {
      const chat = new Conversation();
      const content: Array<ContentPartText | ContentPartFile> = [
        { type: "text", text: "Look at this image and PDF" },
        { type: "file", file: mockImageFile },
        { type: "file", file: mockPdfFile },
      ];

      chat.addUser(content);

      const message = chat.messages[0];
      expect(message.role).toBe("user");
      const text = getTextContent(message.content as any);
      const files = getFiles(message.content as any);

      expect(text).toBe("Look at this image and PDF");
      expect(files).toHaveLength(2);
      expect(files[0]).toBe(mockImageFile);
      expect(files[1]).toBe(mockPdfFile);
    });
  });
});
