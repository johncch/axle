import { describe, expect, test } from "vitest";
import { ContentPartFile, ContentPartText } from "../../src/messages/message.js";
import { getFiles, getTextContent } from "../../src/messages/utils.js";
import { FileInfo } from "../../src/utils/file.js";

describe("message content helpers", () => {
  const imageFile: FileInfo = {
    kind: "image",
    mimeType: "image/jpeg",
    size: 1000,
    name: "image.jpg",
    source: { type: "base64", data: "base64data" },
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
      kind: "document",
      mimeType: "application/pdf",
      size: 2000,
      name: "document.pdf",
      source: { type: "base64", data: "base64data" },
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
