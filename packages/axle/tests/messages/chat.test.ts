import { describe, expect, test } from "vitest";
import { History } from "../../src/core/agent/index.js";
import { ContentPartFile, ContentPartText } from "../../src/messages/message.js";
import { getFiles, getTextContent } from "../../src/messages/utils.js";
import type { Turn } from "../../src/turns/types.js";
import { FileInfo } from "../../src/utils/file.js";

describe("History", () => {
  describe("state management", () => {
    test("turns are set through replaceTurns", () => {
      const history = new History();
      const turns: Turn[] = [
        {
          id: "t1",
          owner: "user",
          parts: [{ id: "p1", type: "text", text: "Hello" }],
          status: "complete",
        },
        {
          id: "t2",
          owner: "agent",
          parts: [{ id: "p2", type: "text", text: "Hi" }],
          status: "complete",
        },
      ];
      history.replaceTurns(turns, []);

      expect(history.turns).toHaveLength(2);
      expect(history.turns[1].id).toBe("t2");
    });

    test("append adds to the active conversation and the archive", () => {
      const history = new History();
      history.append({ role: "user", content: "Hello" });
      history.append({
        role: "assistant",
        id: "a1",
        content: [{ type: "text", text: "Hi" }],
      });

      expect(history.messages).toHaveLength(2);
      expect(history.messages[0].role).toBe("user");
      expect(history.messages[1].role).toBe("assistant");
      expect(history.archive).toHaveLength(2);
    });

    test("constructor accepts initial turns and messages", () => {
      const turns: Turn[] = [{ id: "t1", owner: "user", parts: [], status: "complete" }];
      const messages = [{ role: "user" as const, content: "Hello" }];
      const history = new History({ turns, messages });

      expect(history.turns).toHaveLength(1);
      expect(history.messages).toHaveLength(1);
    });
  });

  describe("helper methods", () => {
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
});
