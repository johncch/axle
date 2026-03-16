import { describe, expect, test } from "vitest";
import { compileTurns } from "../../src/turns/compiler.js";
import type { Turn } from "../../src/turns/types.js";

describe("compileTurns", () => {
  test("empty turns produces empty messages", () => {
    expect(compileTurns([])).toEqual([]);
  });

  test("user turn with text compiles to AxleUserMessage", () => {
    const turns: Turn[] = [
      {
        id: "t1",
        owner: "user",
        parts: [{ id: "p1", type: "text", text: "Hello" }],
      },
    ];

    const messages = compileTurns(turns);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    if (messages[0].role === "user") {
      expect(messages[0].content).toEqual([{ type: "text", text: "Hello" }]);
    }
  });

  test("user turn with file compiles to AxleUserMessage with file part", () => {
    const turns: Turn[] = [
      {
        id: "t1",
        owner: "user",
        parts: [
          { id: "p1", type: "text", text: "Look at this" },
          {
            id: "p2",
            type: "file",
            file: {
              path: "/test.jpg",
              base64: "abc",
              mimeType: "image/jpeg",
              size: 100,
              name: "test.jpg",
              type: "image",
            },
          },
        ],
      },
    ];

    const messages = compileTurns(turns);
    expect(messages).toHaveLength(1);
    if (messages[0].role === "user") {
      expect(messages[0].content).toHaveLength(2);
    }
  });

  test("agent turn with text compiles to AxleAssistantMessage", () => {
    const turns: Turn[] = [
      {
        id: "t1",
        owner: "agent",
        parts: [{ id: "p1", type: "text", text: "Hi there" }],
      },
    ];

    const messages = compileTurns(turns);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("assistant");
    if (messages[0].role === "assistant") {
      expect(messages[0].content).toEqual([{ type: "text", text: "Hi there" }]);
    }
  });

  test("agent turn with thinking compiles to thinking content part", () => {
    const turns: Turn[] = [
      {
        id: "t1",
        owner: "agent",
        parts: [
          { id: "p1", type: "thinking", text: "Let me think...", summary: "Thinking" },
          { id: "p2", type: "text", text: "Here's my answer" },
        ],
      },
    ];

    const messages = compileTurns(turns);
    expect(messages).toHaveLength(1);
    if (messages[0].role === "assistant") {
      expect(messages[0].content).toHaveLength(2);
      expect(messages[0].content[0].type).toBe("thinking");
      expect(messages[0].content[1].type).toBe("text");
    }
  });

  test("agent turn with tool action compiles to tool-call + tool result messages", () => {
    const turns: Turn[] = [
      {
        id: "t1",
        owner: "agent",
        parts: [
          {
            id: "tc1",
            type: "action",
            kind: "tool",
            status: "complete",
            detail: {
              name: "calculator",
              parameters: { expression: "2+2" },
              result: { type: "success", content: "4" },
            },
          },
        ],
      },
    ];

    const messages = compileTurns(turns);
    // Should produce: assistant message with tool-call, then tool result message
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("assistant");
    expect(messages[1].role).toBe("tool");
    if (messages[0].role === "assistant") {
      expect(messages[0].content[0].type).toBe("tool-call");
    }
    if (messages[1].role === "tool") {
      expect(messages[1].content[0].content).toBe("4");
    }
  });

  test("agent turn with internal tool compiles to internal-tool content part", () => {
    const turns: Turn[] = [
      {
        id: "t1",
        owner: "agent",
        parts: [
          {
            id: "it1",
            type: "action",
            kind: "internal-tool",
            status: "complete",
            detail: {
              name: "web_search",
              input: { query: "test" },
              result: { type: "success", content: "search results" },
            },
          },
        ],
      },
    ];

    const messages = compileTurns(turns);
    expect(messages).toHaveLength(1);
    if (messages[0].role === "assistant") {
      expect(messages[0].content[0].type).toBe("internal-tool");
    }
  });

  test("subagent actions are skipped in compilation", () => {
    const turns: Turn[] = [
      {
        id: "t1",
        owner: "agent",
        parts: [
          { id: "p1", type: "text", text: "Delegating..." },
          {
            id: "sa1",
            type: "action",
            kind: "agent",
            status: "complete",
            detail: { name: "sub-agent", children: [], result: { type: "success", content: "done" } },
          },
        ],
      },
    ];

    const messages = compileTurns(turns);
    expect(messages).toHaveLength(1);
    if (messages[0].role === "assistant") {
      // Only the text part, not the subagent action
      expect(messages[0].content).toHaveLength(1);
      expect(messages[0].content[0].type).toBe("text");
    }
  });

  test("multi-turn conversation compiles correctly", () => {
    const turns: Turn[] = [
      {
        id: "t1",
        owner: "user",
        parts: [{ id: "p1", type: "text", text: "Hi" }],
      },
      {
        id: "t2",
        owner: "agent",
        parts: [{ id: "p2", type: "text", text: "Hello!" }],
      },
      {
        id: "t3",
        owner: "user",
        parts: [{ id: "p3", type: "text", text: "How are you?" }],
      },
      {
        id: "t4",
        owner: "agent",
        parts: [{ id: "p4", type: "text", text: "I'm doing well!" }],
      },
    ];

    const messages = compileTurns(turns);
    expect(messages).toHaveLength(4);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[2].role).toBe("user");
    expect(messages[3].role).toBe("assistant");
  });
});
