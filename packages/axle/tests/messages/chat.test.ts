import { describe, expect, test } from "vitest";
import { ContentPart, ContentPartFile, ContentPartText } from "../../src/messages/message.js";
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

  test("getTextContent concatenates adjacent text parts as one run", () => {
    const content: ContentPartText[] = [
      { type: "text", text: "He notes that " },
      { type: "text", text: "the theory is incomplete" },
      { type: "text", text: ", not false." },
    ];

    expect(getTextContent(content)).toBe("He notes that the theory is incomplete, not false.");
  });

  test("getTextContent puts a blank line where another part separates text", () => {
    const content: ContentPart[] = [
      { type: "thinking", id: "thinking-1", summary: "Plan the lookup." },
      { type: "text", text: "Let me check." },
      { type: "tool-call", id: "call-1", name: "lookup", parameters: {} },
      { type: "text", text: "It is " },
      { type: "text", text: "42." },
    ];

    expect(getTextContent(content)).toBe("Let me check.\n\nIt is 42.");
  });

  test("getTextContent does not break text at a citation part", () => {
    const content: ContentPart[] = [
      { type: "text", text: "The sky is " },
      { type: "citation", citations: [] },
      { type: "text", text: "blue." },
    ];

    expect(getTextContent(content)).toBe("The sky is blue.");
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
