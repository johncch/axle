import { describe, expect, test } from "vitest";
import { ContentPartText, ContentPartThinking } from "../../../../src/messages/message.js";
import { convertAxleMessageToResponseInput } from "../../../../src/providers/openai/utils.js";

describe("responsesAPI utils", () => {
  describe("convertAxleMessageToResponseInput", () => {
    test("should convert simple user message", async () => {
      const messages = [
        {
          role: "user" as const,
          content: "Hello, how are you?",
          metadata: { source: "system-editor" },
        },
      ];

      const result = await convertAxleMessageToResponseInput(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        role: "user",
        content: "Hello, how are you?",
      });
      expect(result[0]).not.toHaveProperty("metadata");
    });

    test("should convert assistant message with text content", async () => {
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

      const result = await convertAxleMessageToResponseInput(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        role: "assistant",
        content: "I'm doing well, thank you!",
      });
    });

    test("should skip thinking content in assistant messages", async () => {
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

      const result = await convertAxleMessageToResponseInput(messages);

      expect(result).toHaveLength(0);
    });

    test("should convert assistant message with both thinking and text content, skipping thinking", async () => {
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

      const result = await convertAxleMessageToResponseInput(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        role: "assistant",
        content: "Based on my analysis, here's the answer.",
      });
    });

    test("should skip multiple thinking blocks, keep text", async () => {
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

      const result = await convertAxleMessageToResponseInput(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        role: "assistant",
        content: "Final answer.",
      });
    });

    test("should convert assistant message with tool calls", async () => {
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

      const result = await convertAxleMessageToResponseInput(messages);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        role: "assistant",
        content: "Let me search for that.",
      });
      expect(result[1]).toMatchObject({
        type: "function_call",
        call_id: "call_123",
        name: "search",
        arguments: '{"query":"test"}',
      });
    });

    test("should convert tool message", async () => {
      const messages = [
        {
          role: "tool" as const,
          id: "tool-msg-1",
          content: [
            {
              id: "call_123",
              name: "search",
              content: "Search results: ...",
            },
          ],
        },
      ];

      const result = await convertAxleMessageToResponseInput(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: "function_call_output",
        call_id: "call_123",
        output: "Search results: ...",
      });
    });

    test("should convert user message with file content", async () => {
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
                kind: "image" as const,
                name: "test.png",
                mimeType: "image/png",
                size: 100,
                source: {
                  type: "base64" as const,
                  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                },
              },
            },
          ],
        },
      ];

      const result = await convertAxleMessageToResponseInput(messages);

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

    test("should convert user message with PDF document as data URL", async () => {
      const messages = [
        {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: "Summarize this.",
            },
            {
              type: "file" as const,
              file: {
                kind: "document" as const,
                name: "doc.pdf",
                mimeType: "application/pdf",
                size: 100,
                source: {
                  type: "base64" as const,
                  data: "JVBERi0xLjQK",
                },
              },
            },
          ],
        },
      ];

      const result = await convertAxleMessageToResponseInput(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        role: "user",
        content: [
          { type: "input_text", text: "Summarize this." },
          {
            type: "input_file",
            filename: "doc.pdf",
            file_data: "data:application/pdf;base64,JVBERi0xLjQK",
          },
        ],
      });
    });

    test("should pass through PDF document URL", async () => {
      const messages = [
        {
          role: "user" as const,
          content: [
            {
              type: "file" as const,
              file: {
                kind: "document" as const,
                name: "doc.pdf",
                mimeType: "application/pdf",
                source: {
                  type: "url" as const,
                  url: "https://example.com/doc.pdf",
                },
              },
            },
          ],
        },
      ];

      const result = await convertAxleMessageToResponseInput(messages);

      // file_url and filename are mutually exclusive in the Responses API, so
      // a URL-sourced document must carry file_url alone.
      const part = (result[0] as { content: unknown[] }).content[0];
      expect(part).toEqual({
        type: "input_file",
        file_url: "https://example.com/doc.pdf",
      });
      expect(part).not.toHaveProperty("filename");
    });

    test("should handle mixed conversation with thinking (thinking skipped)", async () => {
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

      const result = await convertAxleMessageToResponseInput(messages);

      expect(result).toHaveLength(2);

      expect(result[0]).toEqual({
        role: "user",
        content: "Solve this problem: 2 + 2",
      });

      expect(result[1]).toEqual({
        role: "assistant",
        content: "The answer is 4.",
      });
    });

    describe("assistant item order", () => {
      const firstSearch = {
        id: "ws_1",
        type: "web_search_call",
        status: "completed",
        action: { type: "search", query: "OpenAI official homepage" },
      };
      const secondSearch = {
        id: "ws_2",
        type: "web_search_call",
        status: "completed",
        action: { type: "open_page", url: "https://openai.com/" },
      };
      const reasoning = {
        type: "thinking" as const,
        id: "rs_1",
        continuity: { provider: "openai" as const, encrypted: "enc" },
      };

      test("sends a reasoning item back directly before the search that follows it", async () => {
        const result = await convertAxleMessageToResponseInput([
          {
            role: "assistant",
            id: "resp_1",
            content: [
              { type: "provider-tool", id: "ws_1", name: "web_search_call", output: firstSearch },
              reasoning,
              { type: "provider-tool", id: "ws_2", name: "web_search_call", output: secondSearch },
              { type: "text", text: "OpenAI's homepage is https://openai.com/." },
            ],
          },
        ]);

        expect(result).toEqual([
          firstSearch,
          { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "enc" },
          secondSearch,
          { role: "assistant", content: "OpenAI's homepage is https://openai.com/." },
        ]);
      });

      test("keeps text on either side of a tool call as separate messages", async () => {
        const result = await convertAxleMessageToResponseInput([
          {
            role: "assistant",
            id: "resp_1",
            content: [
              { type: "text", text: "Checking." },
              { type: "tool-call", id: "call_1", name: "lookup", parameters: { key: "a" } },
              { type: "text", text: "Done." },
            ],
          },
        ]);

        expect(result).toEqual([
          { role: "assistant", content: "Checking." },
          { type: "function_call", call_id: "call_1", name: "lookup", arguments: '{"key":"a"}' },
          { role: "assistant", content: "Done." },
        ]);
      });

      test("sends a text part's phase back on its message", async () => {
        const result = await convertAxleMessageToResponseInput([
          {
            role: "assistant",
            id: "resp_1",
            content: [
              {
                type: "text",
                text: "Checking.",
                providerMetadata: { provider: "openai", phase: "commentary" },
              },
              { type: "tool-call", id: "call_1", name: "lookup", parameters: {} },
            ],
          },
        ]);

        expect(result[0]).toEqual({ role: "assistant", content: "Checking.", phase: "commentary" });
      });

      test("keeps adjacent text with different phases as separate messages", async () => {
        const result = await convertAxleMessageToResponseInput([
          {
            role: "assistant",
            id: "resp_1",
            content: [
              {
                type: "text",
                text: "Checking.",
                providerMetadata: { provider: "openai", phase: "commentary" },
              },
              {
                type: "text",
                text: "It is 4127.",
                providerMetadata: { provider: "openai", phase: "final_answer" },
              },
            ],
          },
        ]);

        expect(result).toEqual([
          { role: "assistant", content: "Checking.", phase: "commentary" },
          { role: "assistant", content: "It is 4127.", phase: "final_answer" },
        ]);
      });

      test("ignores a phase recorded by another provider", async () => {
        const result = await convertAxleMessageToResponseInput([
          {
            role: "assistant",
            id: "msg_1",
            content: [
              {
                type: "text",
                text: "Hello.",
                providerMetadata: { provider: "other", phase: "commentary" },
              },
            ],
          },
        ]);

        expect(result).toEqual([{ role: "assistant", content: "Hello." }]);
      });

      test("joins text around a part that is not sent back into one message", async () => {
        const result = await convertAxleMessageToResponseInput([
          {
            role: "assistant",
            id: "msg_1",
            content: [
              { type: "text", text: "First." },
              { type: "thinking", text: "Not from OpenAI." },
              { type: "text", text: "Second." },
            ],
          },
        ]);

        expect(result).toEqual([{ role: "assistant", content: "First.\n\nSecond." }]);
      });
    });
  });
});
