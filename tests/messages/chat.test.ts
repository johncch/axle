import { describe, expect, test } from "vitest";
import { History } from "../../src/messages/history.js";
import { ContentPartFile, ContentPartText } from "../../src/messages/message.js";
import { getFiles, getTextContent } from "../../src/messages/utils.js";
import { FileInfo } from "../../src/utils/file.js";
import type { Turn } from "../../src/turns/types.js";

describe("History", () => {
  describe("turn management", () => {
    test("addTurn adds a user turn", () => {
      const history = new History();
      const turn: Turn = {
        id: "t1",
        owner: "user",
        parts: [{ id: "p1", type: "text", text: "Hello" }],
      };
      history.addTurn(turn);

      expect(history.turns).toHaveLength(1);
      expect(history.turns[0].owner).toBe("user");
    });

    test("addTurn adds an agent turn", () => {
      const history = new History();
      const turn: Turn = {
        id: "t1",
        owner: "agent",
        parts: [{ id: "p1", type: "text", text: "Hi there" }],
      };
      history.addTurn(turn);

      expect(history.turns).toHaveLength(1);
      expect(history.turns[0].owner).toBe("agent");
    });

    test("latestTurn returns the most recent turn", () => {
      const history = new History();
      history.addTurn({ id: "t1", owner: "user", parts: [{ id: "p1", type: "text", text: "Hello" }] });
      history.addTurn({ id: "t2", owner: "agent", parts: [{ id: "p2", type: "text", text: "Hi" }] });

      expect(history.latestTurn()?.id).toBe("t2");
    });

    test("updateTurn modifies a turn in place", () => {
      const history = new History();
      history.addTurn({ id: "t1", owner: "agent", parts: [] });

      history.updateTurn("t1", (turn) => ({
        ...turn,
        parts: [{ id: "p1", type: "text", text: "Updated" }],
      }));

      expect(history.turns[0].parts).toHaveLength(1);
    });

    test("system property can be set", () => {
      const history = new History();
      history.system = "You are a helpful assistant";

      expect(history.system).toBe("You are a helpful assistant");
    });
  });

  describe("toMessages", () => {
    test("compiles user turn to AxleUserMessage", () => {
      const history = new History();
      history.addTurn({
        id: "t1",
        owner: "user",
        parts: [{ id: "p1", type: "text", text: "Hello" }],
      });

      const messages = history.toMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("user");
    });

    test("compiles agent turn with text to AxleAssistantMessage", () => {
      const history = new History();
      history.addTurn({
        id: "t1",
        owner: "agent",
        parts: [{ id: "p1", type: "text", text: "Hi there" }],
      });

      const messages = history.toMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("assistant");
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
      const history = new History();
      history.system = "System message";
      history.addTurn({ id: "t1", owner: "user", parts: [{ id: "p1", type: "text", text: "User message" }] });

      const result = history.toString();
      const parsed = JSON.parse(result);

      expect(parsed.system).toBe("System message");
      expect(parsed.turns).toHaveLength(1);
    });
  });
});
