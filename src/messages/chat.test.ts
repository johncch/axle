import { describe, expect, test } from "@jest/globals";
import { FileInfo } from "../utils/file.js";
import { Chat, getFiles, getTextContent, getInstructions, getTextAndInstructions } from "./chat.js";

describe("Chat", () => {
  describe("basic functionality", () => {
    test("addUser with string content", () => {
      const chat = new Chat();
      chat.addUser("Hello");

      expect(chat.messages).toHaveLength(1);
      expect(chat.messages[0].role).toBe("user");
      expect(chat.messages[0].content).toBe("Hello");
    });

    test("addUser with instructions creates multimodal content", () => {
      const chat = new Chat();
      chat.addUser("Hello", "Please be friendly");

      expect(chat.messages).toHaveLength(1);
      expect(chat.messages[0].role).toBe("user");
      expect(Array.isArray(chat.messages[0].content)).toBe(true);

      const content = chat.messages[0].content as any[];
      expect(content).toHaveLength(2);
      expect(content[0].type).toBe("text");
      expect(content[0].text).toBe("Hello");
      expect(content[1].type).toBe("instructions");
      expect(content[1].instructions).toBe("Please be friendly");
    });

    test("addUser with instructions and files creates multimodal content", () => {
      const chat = new Chat();
      const mockImageFile: FileInfo = {
        path: "/test/image.jpg",
        base64: "base64data",
        mimeType: "image/jpeg",
        size: 1000,
        name: "image.jpg",
        type: "image",
      };

      chat.addUser("Analyze this", "Be thorough", [mockImageFile]);

      expect(chat.messages).toHaveLength(1);
      expect(chat.messages[0].role).toBe("user");
      expect(Array.isArray(chat.messages[0].content)).toBe(true);

      const content = chat.messages[0].content as any[];
      expect(content).toHaveLength(3);
      expect(content[0].type).toBe("text");
      expect(content[0].text).toBe("Analyze this");
      expect(content[1].type).toBe("instructions");
      expect(content[1].instructions).toBe("Be thorough");
      expect(content[2].type).toBe("file");
      expect(content[2].file).toBe(mockImageFile);
    });

    test("addSystem sets system message", () => {
      const chat = new Chat();
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

    test("addUser with no files behaves like addUser", () => {
      const chat = new Chat();
      chat.addUser("Hello", []);

      expect(chat.messages).toHaveLength(1);
      expect(chat.messages[0].role).toBe("user");
      expect(chat.messages[0].content).toBe("Hello");
    });

    test("addUser with files creates multimodal content", () => {
      const chat = new Chat();
      chat.addUser("Analyze this image", [mockImageFile]);

      expect(chat.messages).toHaveLength(1);
      expect(chat.messages[0].role).toBe("user");
      expect(Array.isArray(chat.messages[0].content)).toBe(true);

      const content = chat.messages[0].content as any[];
      expect(content).toHaveLength(2);
      expect(content[0].type).toBe("text");
      expect(content[0].text).toBe("Analyze this image");
      expect(content[1].type).toBe("file");
      expect(content[1].file).toBe(mockImageFile);
    });

    test("addUser with multiple files", () => {
      const chat = new Chat();
      chat.addUser("Analyze these files", [mockImageFile, mockPdfFile]);

      expect(chat.messages).toHaveLength(1);
      const content = chat.messages[0].content as any[];
      expect(content).toHaveLength(3);
      expect(content[0].type).toBe("text");
      expect(content[1].type).toBe("file");
      expect(content[1].file).toBe(mockImageFile);
      expect(content[2].type).toBe("file");
      expect(content[2].file).toBe(mockPdfFile);
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

    test("getTextContent extracts text from string content", () => {
      const text = getTextContent("Hello world");

      expect(text).toBe("Hello world");
    });

    test("getTextContent extracts text from multimodal content", () => {
      const content = [
        { type: "text", text: "Hello" },
        { type: "text", text: "world" },
        { type: "file", file: imageFile },
      ];

      const text = getTextContent(content as any);
      expect(text).toBe("Hello\n\nworld");
    });

    test("getFiles returns empty array for string content", () => {
      const files = getFiles("Hello world");

      expect(files).toEqual([]);
    });

    test("getFiles extracts files from multimodal content", () => {
      const content = [
        { type: "text", text: "Hello" },
        { type: "file", file: imageFile },
      ];

      const files = getFiles(content as any);
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

      const content = [
        { type: "text", text: "Hello" },
        { type: "file", file: imageFile },
        { type: "file", file: documentFile },
      ];

      const files = getFiles(content as any);
      expect(files).toHaveLength(2);
      expect(files[0]).toBe(imageFile);
      expect(files[1]).toBe(documentFile);
    });

    test("getInstructions returns null for string content", () => {
      const instructions = getInstructions("Hello world");

      expect(instructions).toBeNull();
    });

    test("getInstructions extracts instructions from multimodal content", () => {
      const content = [
        { type: "text", text: "Hello" },
        { type: "instructions", instructions: "Be helpful" },
        { type: "file", file: imageFile },
      ];

      const instructions = getInstructions(content as any);
      expect(instructions).toBe("Be helpful");
    });

    test("getInstructions with multiple instruction blocks", () => {
      const content = [
        { type: "text", text: "Hello" },
        { type: "instructions", instructions: "Be helpful" },
        { type: "instructions", instructions: "Be concise" },
      ];

      const instructions = getInstructions(content as any);
      expect(instructions).toBe("Be helpful\n\nBe concise");
    });

    test("getTextAndInstructions combines text and instructions", () => {
      const content = [
        { type: "text", text: "Hello" },
        { type: "instructions", instructions: "Be helpful" },
        { type: "file", file: imageFile },
      ];

      const combined = getTextAndInstructions(content as any);
      expect(combined).toBe("Hello\n\nBe helpful");
    });

    test("getTextAndInstructions with custom delimiter", () => {
      const content = [
        { type: "text", text: "Hello" },
        { type: "instructions", instructions: "Be helpful" },
      ];

      const combined = getTextAndInstructions(content as any, " | ");
      expect(combined).toBe("Hello | Be helpful");
    });

    test("getTextAndInstructions returns string content as-is", () => {
      const combined = getTextAndInstructions("Hello world");
      expect(combined).toBe("Hello world");
    });
  });

  describe("edge cases", () => {
    test("addUser with empty instruction creates simple string content", () => {
      const chat = new Chat();
      chat.addUser("Hello", "");

      expect(chat.messages).toHaveLength(1);
      expect(chat.messages[0].role).toBe("user");
      expect(chat.messages[0].content).toBe("Hello");
      expect(Array.isArray(chat.messages[0].content)).toBe(false);
    });

    test("addUser with instruction and empty files array", () => {
      const chat = new Chat();
      chat.addUser("Hello", "Be nice", []);

      expect(chat.messages).toHaveLength(1);
      expect(Array.isArray(chat.messages[0].content)).toBe(true);

      const content = chat.messages[0].content as any[];
      expect(content).toHaveLength(2);
      expect(content[0].type).toBe("text");
      expect(content[1].type).toBe("instructions");
      expect(content[1].instructions).toBe("Be nice");
    });
  });

  describe("toString", () => {
    test("serializes chat to JSON string", () => {
      const chat = new Chat();
      chat.addSystem("System message");
      chat.addUser("User message");

      const result = chat.toString();
      const parsed = JSON.parse(result);

      expect(parsed.system).toBe("System message");
      expect(parsed.messages).toHaveLength(1);
      expect(parsed.tools).toEqual([]);
    });
  });
});
