import { describe, expect, test } from "vitest";
import { convertAxleMessageToResponseInput } from "../../../../src/ai/openai/utils/responsesAPI.js";
import { ContentPartText, ContentPartThinking } from "../../../../src/messages/types.js";

describe("responsesAPI utils", () => {
  describe("convertAxleMessageToResponseInput", () => {
    test("should convert simple user message", () => {
      const messages = [
        {
          role: "user" as const,
          content: "Hello, how are you?",
        },
      ];

      const result = convertAxleMessageToResponseInput(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        role: "user",
        content: "Hello, how are you?",
      });
    });

    test("should convert assistant message with text content", () => {
      const messages = [
        {
          role: "assistant" as const,
          id: "msg_123",
          content: [
            {
              type: "text" as const,
              text: "I'm doing well, thank you!",
            },
          ],
        },
      ];

      const result = convertAxleMessageToResponseInput(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        role: "assistant",
        content: "I'm doing well, thank you!",
      });
    });

    test("should convert assistant message with thinking content", () => {
      const messages = [
        {
          role: "assistant" as const,
          id: "msg_123",
          content: [
            {
              type: "thinking" as const,
              text: "Let me think about this problem step by step...",
            } as ContentPartThinking,
          ],
        },
      ];

      const result = convertAxleMessageToResponseInput(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: "reasoning",
        summary: [
          {
            type: "summary_text",
            text: "Let me think about this problem step by step...",
          },
        ],
      });
      expect(result[0]).toHaveProperty("id");
    });

    test("should convert assistant message with both thinking and text content", () => {
      const messages = [
        {
          role: "assistant" as const,
          id: "msg_123",
          content: [
            {
              type: "thinking" as const,
              text: "First, I need to analyze the question...",
            } as ContentPartThinking,
            {
              type: "text" as const,
              text: "Based on my analysis, here's the answer.",
            } as ContentPartText,
          ],
        },
      ];

      const result = convertAxleMessageToResponseInput(messages);

      expect(result).toHaveLength(2);

      // First item should be the reasoning
      expect(result[0]).toMatchObject({
        type: "reasoning",
        summary: [
          {
            type: "summary_text",
            text: "First, I need to analyze the question...",
          },
        ],
      });

      // Second item should be the assistant message
      expect(result[1]).toEqual({
        role: "assistant",
        content: "Based on my analysis, here's the answer.",
      });
    });

    test("should convert assistant message with multiple thinking blocks", () => {
      const messages = [
        {
          role: "assistant" as const,
          id: "msg_123",
          content: [
            {
              type: "thinking" as const,
              text: "First thought...",
            } as ContentPartThinking,
            {
              type: "thinking" as const,
              text: "Second thought...",
            } as ContentPartThinking,
            {
              type: "text" as const,
              text: "Final answer.",
            } as ContentPartText,
          ],
        },
      ];

      const result = convertAxleMessageToResponseInput(messages);

      expect(result).toHaveLength(3);

      // First two should be reasoning
      expect(result[0]).toMatchObject({
        type: "reasoning",
        summary: [
          {
            type: "summary_text",
            text: "First thought...",
          },
        ],
      });

      expect(result[1]).toMatchObject({
        type: "reasoning",
        summary: [
          {
            type: "summary_text",
            text: "Second thought...",
          },
        ],
      });

      // Third should be the message
      expect(result[2]).toEqual({
        role: "assistant",
        content: "Final answer.",
      });
    });

    test("should convert assistant message with tool calls", () => {
      const messages = [
        {
          role: "assistant" as const,
          id: "msg_123",
          content: [
            {
              type: "text" as const,
              text: "Let me search for that.",
            } as ContentPartText,
            {
              type: "tool-call" as const,
              id: "call_123",
              name: "search",
              parameters: { query: "test" },
            },
          ],
        },
      ];

      const result = convertAxleMessageToResponseInput(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        role: "assistant",
        content: "Let me search for that.",
        toolCalls: [
          {
            type: "function",
            id: "call_123",
            function: {
              name: "search",
              arguments: '{"query":"test"}',
            },
          },
        ],
      });
    });

    test("should convert tool message", () => {
      const messages = [
        {
          role: "tool" as const,
          content: [
            {
              id: "call_123",
              name: "search",
              content: "Search results: ...",
            },
          ],
        },
      ];

      const result = convertAxleMessageToResponseInput(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: "function_call_output",
        call_id: "call_123",
        output: "Search results: ...",
      });
    });

    test("should convert user message with file content", () => {
      const messages = [
        {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: "What's in this image?",
            },
            {
              type: "file" as const,
              file: {
                type: "image" as const,
                path: "test.png",
                name: "test.png",
                mimeType: "image/png",
                size: 100,
                base64:
                  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
              },
            },
          ],
        },
      ];

      const result = convertAxleMessageToResponseInput(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        role: "user",
        content: [
          {
            type: "input_text",
            text: "What's in this image?",
          },
          {
            type: "input_image",
            image_url: expect.stringContaining("data:image/png;base64,"),
            detail: "auto",
          },
        ],
      });
    });

    test("should handle mixed conversation with thinking", () => {
      const messages = [
        {
          role: "user" as const,
          content: "Solve this problem: 2 + 2",
        },
        {
          role: "assistant" as const,
          id: "msg_123",
          content: [
            {
              type: "thinking" as const,
              text: "This is a simple addition problem...",
            } as ContentPartThinking,
            {
              type: "text" as const,
              text: "The answer is 4.",
            } as ContentPartText,
          ],
        },
      ];

      const result = convertAxleMessageToResponseInput(messages);

      expect(result).toHaveLength(3);

      expect(result[0]).toEqual({
        role: "user",
        content: "Solve this problem: 2 + 2",
      });

      expect(result[1]).toMatchObject({
        type: "reasoning",
        summary: [
          {
            type: "summary_text",
            text: "This is a simple addition problem...",
          },
        ],
      });

      expect(result[2]).toEqual({
        role: "assistant",
        content: "The answer is 4.",
      });
    });
  });
});
