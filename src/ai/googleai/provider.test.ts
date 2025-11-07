import { Type } from "@google/genai";
import { ToolSchema } from "../../tools/types.js";
import { FileInfo } from "../../utils/file.js";
import { Chat } from "../chat.js";
import { ChatContent, ToolCall } from "../types.js";
import { prepareRequest } from "./provider.js";

describe("prepareRequest", () => {
  describe("simple string content", () => {
    it("should handle single user message with string content", () => {
      const chat = new Chat();
      chat.addUser("Hello, how are you?");

      const result = prepareRequest(chat);

      expect(result.contents).toBe("Hello, how are you?");
      expect(result.config).toEqual({});
    });

    it("should handle single user message with string content and system instruction", () => {
      const chat = new Chat();
      chat.addSystem("You are a helpful assistant");
      chat.addUser("Hello, how are you?");

      const result = prepareRequest(chat);

      expect(result.contents).toBe("Hello, how are you?");
      expect(result.config).toEqual({
        systemInstruction: "You are a helpful assistant",
      });
    });
  });

  describe("multiple messages", () => {
    it("should handle multiple user messages", () => {
      const chat = new Chat();
      chat.addUser("First message");
      chat.addUser("Second message");

      const result = prepareRequest(chat);

      expect(Array.isArray(result.contents)).toBe(true);
      const contents = result.contents as any[];
      expect(contents).toHaveLength(2);
      expect(contents[0]).toEqual({
        role: "user",
        parts: [{ text: "First message" }],
      });
      expect(contents[1]).toEqual({
        role: "user",
        parts: [{ text: "Second message" }],
      });
    });

    it("should handle user and assistant messages", () => {
      const chat = new Chat();
      chat.addUser("Hello");
      chat.addAssistant("Hi there!");

      const result = prepareRequest(chat);

      expect(Array.isArray(result.contents)).toBe(true);
      const contents = result.contents as any[];
      expect(contents).toHaveLength(2);
      expect(contents[0]).toEqual({
        role: "user",
        parts: [{ text: "Hello" }],
      });
      expect(contents[1]).toEqual({
        role: "assistant",
        parts: [{ text: "Hi there!" }],
      });
    });

    it("should handle assistant message with no content", () => {
      const chat = new Chat();
      chat.addUser("Hello");
      chat.addAssistant("");

      const result = prepareRequest(chat);

      expect(Array.isArray(result.contents)).toBe(true);
      const contents = result.contents as any[];
      expect(contents[1]).toEqual({
        role: "assistant",
        parts: [{ text: "" }],
      });
    });
  });

  describe("tool calls and responses", () => {
    it("should handle assistant message with tool calls", () => {
      const chat = new Chat();
      chat.addUser("What's the weather?");

      const toolCalls: ToolCall[] = [
        {
          id: "call_1",
          name: "get_weather",
          arguments: '{"location": "New York"}',
        },
      ];
      chat.addAssistant("Let me check the weather for you.", toolCalls);

      const result = prepareRequest(chat);

      expect(Array.isArray(result.contents)).toBe(true);
      const contents = result.contents as any[];
      expect(contents[1]).toEqual({
        role: "assistant",
        parts: [
          { text: "Let me check the weather for you." },
          {
            functionCall: {
              id: "call_1",
              name: "get_weather",
              args: { location: "New York" },
            },
          },
        ],
      });
    });

    it("should handle assistant message with tool calls and object arguments", () => {
      const chat = new Chat();
      chat.addUser("Calculate something");

      const toolCalls: ToolCall[] = [
        {
          id: "call_2",
          name: "calculator",
          arguments: { operation: "add", numbers: [1, 2, 3] },
        },
      ];
      chat.addAssistant("I'll calculate that for you.", toolCalls);

      const result = prepareRequest(chat);

      expect(Array.isArray(result.contents)).toBe(true);
      const contents = result.contents as any[];
      expect(contents[1]).toEqual({
        role: "assistant",
        parts: [
          { text: "I'll calculate that for you." },
          {
            functionCall: {
              id: "call_2",
              name: "calculator",
              args: { operation: "add", numbers: [1, 2, 3] },
            },
          },
        ],
      });
    });

    it("should handle assistant message with only tool calls (no content)", () => {
      const chat = new Chat();
      chat.addUser("What's the weather?");

      const toolCalls: ToolCall[] = [
        {
          id: "call_1",
          name: "get_weather",
          arguments: '{"location": "New York"}',
        },
      ];
      chat.addAssistant(undefined, toolCalls);

      const result = prepareRequest(chat);

      expect(Array.isArray(result.contents)).toBe(true);
      const contents = result.contents as any[];
      expect(contents[1]).toEqual({
        role: "assistant",
        parts: [
          {
            functionCall: {
              id: "call_1",
              name: "get_weather",
              args: { location: "New York" },
            },
          },
        ],
      });
    });

    it("should handle tool response messages", () => {
      const chat = new Chat();
      chat.addUser("What's the weather?");
      chat.addTools([
        {
          id: "call_1",
          name: "get_weather",
          content: "It's sunny and 75°F in New York",
        },
      ]);

      const result = prepareRequest(chat);

      expect(Array.isArray(result.contents)).toBe(true);
      const contents = result.contents as any[];
      expect(contents[1]).toEqual({
        role: "user",
        parts: [
          {
            functionResponse: {
              id: "call_1",
              name: "get_weather",
              response: {
                output: "It's sunny and 75°F in New York",
              },
            },
          },
        ],
      });
    });

    it("should handle multiple tool responses", () => {
      const chat = new Chat();
      chat.addUser("Get info");
      chat.addTools([
        {
          id: "call_1",
          name: "tool_1",
          content: "Result 1",
        },
        {
          id: "call_2",
          name: "tool_2",
          content: "Result 2",
        },
      ]);

      const result = prepareRequest(chat);

      expect(Array.isArray(result.contents)).toBe(true);
      const contents = result.contents as any[];
      expect(contents[1]).toEqual({
        role: "user",
        parts: [
          {
            functionResponse: {
              id: "call_1",
              name: "tool_1",
              response: { output: "Result 1" },
            },
          },
          {
            functionResponse: {
              id: "call_2",
              name: "tool_2",
              response: { output: "Result 2" },
            },
          },
        ],
      });
    });
  });

  describe("multimodal content", () => {
    it("should handle user message with text and images", () => {
      const chat = new Chat();
      const imageFile: FileInfo = {
        path: "/path/to/image.jpg",
        base64:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
        mimeType: "image/jpeg",
        size: 1024,
        name: "image.jpg",
        type: "image",
      };

      chat.addUser("Look at this image", [imageFile]);

      const result = prepareRequest(chat);

      expect(Array.isArray(result.contents)).toBe(true);
      const contents = result.contents as any[];
      expect(contents[0]).toEqual({
        role: "user",
        parts: [
          { text: "Look at this image" },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
            },
          },
        ],
      });
    });

    it("should handle user message with text and documents", () => {
      const chat = new Chat();
      const documentFile: FileInfo = {
        path: "/path/to/doc.pdf",
        base64:
          "JVBERi0xLjQKJcOkw7zDtsO4CjIgMCBvYmoKPDwKL0xlbmd0aCAzIDAgUko+PgpzdHJlYW0K",
        mimeType: "application/pdf",
        size: 2048,
        name: "doc.pdf",
        type: "document",
      };

      chat.addUser("Analyze this document", [documentFile]);

      const result = prepareRequest(chat);

      expect(Array.isArray(result.contents)).toBe(true);
      const contents = result.contents as any[];
      expect(contents[0]).toEqual({
        role: "user",
        parts: [
          { text: "Analyze this document" },
          {
            inlineData: {
              mimeType: "application/pdf",
              data: "JVBERi0xLjQKJcOkw7zDtsO4CjIgMCBvYmoKPDwKL0xlbmd0aCAzIDAgUko+PgpzdHJlYW0K",
            },
          },
        ],
      });
    });

    it("should handle user message with mixed content types", () => {
      const chat = new Chat();
      const content: ChatContent[] = [
        { type: "text", text: "Here's some text" },
        { type: "instructions", instructions: "Follow these instructions" },
        {
          type: "file",
          file: {
            path: "/path/to/image.png",
            base64: "imagebase64data",
            mimeType: "image/png",
            size: 1024,
            name: "image.png",
            type: "image",
          },
        },
        {
          type: "file",
          file: {
            path: "/path/to/doc.pdf",
            base64: "documentbase64data",
            mimeType: "application/pdf",
            size: 2048,
            name: "doc.pdf",
            type: "document",
          },
        },
      ];

      chat.messages.push({ role: "user", content });

      const result = prepareRequest(chat);

      expect(Array.isArray(result.contents)).toBe(true);
      const contents = result.contents as any[];
      expect(contents[0]).toEqual({
        role: "user",
        parts: [
          { text: "Here's some text\n\nFollow these instructions" },
          {
            inlineData: {
              mimeType: "image/png",
              data: "imagebase64data",
            },
          },
          {
            inlineData: {
              mimeType: "application/pdf",
              data: "documentbase64data",
            },
          },
        ],
      });
    });

    it("should handle user message with only files (no text)", () => {
      const chat = new Chat();
      const content: ChatContent[] = [
        {
          type: "file",
          file: {
            path: "/path/to/image.jpg",
            base64: "imagedata",
            mimeType: "image/jpeg",
            size: 1024,
            name: "image.jpg",
            type: "image",
          },
        },
      ];

      chat.messages.push({ role: "user", content });

      const result = prepareRequest(chat);

      expect(Array.isArray(result.contents)).toBe(true);
      const contents = result.contents as any[];
      expect(contents[0]).toEqual({
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: "imagedata",
            },
          },
        ],
      });
    });
  });

  describe("tool schemas", () => {
    it("should include tool schemas in config", () => {
      const chat = new Chat();
      const toolSchemas: ToolSchema[] = [
        {
          name: "get_weather",
          description: "Get current weather for a location",
          parameters: {
            type: "object",
            properties: {
              location: {
                type: "string",
                description: "The city and state",
              },
            },
            required: ["location"],
          },
        },
        {
          name: "calculator",
          description: "Perform mathematical calculations",
          parameters: {
            type: "object",
            properties: {
              operation: {
                type: "string",
                enum: ["add", "subtract", "multiply", "divide"],
              },
              numbers: {
                type: "array",
                items: { type: "number" },
              },
            },
            required: ["operation", "numbers"],
          },
        },
      ];

      chat.setToolSchemas(toolSchemas);
      chat.addUser("Hello");

      const result = prepareRequest(chat);

      expect(result.config.tools).toEqual([
        {
          functionDeclarations: [
            {
              name: "get_weather",
              description: "Get current weather for a location",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  location: {
                    type: "string",
                    description: "The city and state",
                  },
                },
                required: ["location"],
              },
            },
          ],
        },
        {
          functionDeclarations: [
            {
              name: "calculator",
              description: "Perform mathematical calculations",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  operation: {
                    type: "string",
                    enum: ["add", "subtract", "multiply", "divide"],
                  },
                  numbers: {
                    type: "array",
                    items: { type: "number" },
                  },
                },
                required: ["operation", "numbers"],
              },
            },
          ],
        },
      ]);
    });

    it("should handle empty tool schemas", () => {
      const chat = new Chat();
      chat.addUser("Hello");

      const result = prepareRequest(chat);

      expect(result.config.tools).toBeUndefined();
    });
  });

  describe("system instructions", () => {
    it("should include system instruction in config", () => {
      const chat = new Chat();
      chat.addSystem("You are a helpful AI assistant specialized in coding.");
      chat.addUser("Help me with JavaScript");

      const result = prepareRequest(chat);

      expect(result.config.systemInstruction).toBe(
        "You are a helpful AI assistant specialized in coding.",
      );
    });

    it("should handle no system instruction", () => {
      const chat = new Chat();
      chat.addUser("Hello");

      const result = prepareRequest(chat);

      expect(result.config.systemInstruction).toBeUndefined();
    });
  });

  describe("complex scenarios", () => {
    it("should handle complete conversation flow", () => {
      const chat = new Chat();
      chat.addSystem("You are a helpful assistant");

      const toolSchemas: ToolSchema[] = [
        {
          name: "search",
          description: "Search for information",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
          },
        },
      ];
      chat.setToolSchemas(toolSchemas);

      // User asks a question
      chat.addUser("What's the capital of France?");

      // Assistant responds with tool call
      chat.addAssistant("Let me search for that information.", [
        {
          id: "search_1",
          name: "search",
          arguments: '{"query": "capital of France"}',
        },
      ]);

      // Tool responds
      chat.addTools([
        {
          id: "search_1",
          name: "search",
          content: "Paris is the capital of France",
        },
      ]);

      // Assistant gives final answer
      chat.addAssistant("The capital of France is Paris.");

      const result = prepareRequest(chat);

      expect(result.config.systemInstruction).toBe(
        "You are a helpful assistant",
      );
      expect(result.config.tools).toHaveLength(1);
      expect(Array.isArray(result.contents)).toBe(true);
      expect(result.contents).toHaveLength(4);
    });

    it("should handle tool calls without id", () => {
      const chat = new Chat();
      chat.addUser("Hello");

      const toolCalls: ToolCall[] = [
        {
          id: undefined as any, // Simulating no ID
          name: "test_tool",
          arguments: '{"param": "value"}',
        },
      ];
      chat.addAssistant("Using tool", toolCalls);

      const result = prepareRequest(chat);

      expect(Array.isArray(result.contents)).toBe(true);
      const contents = result.contents as any[];
      expect(contents[1].parts[1].functionCall.id).toBeUndefined();
      expect(contents[1].parts[1].functionCall.name).toBe("test_tool");
    });

    it("should handle tool responses without id", () => {
      const chat = new Chat();
      chat.addUser("Hello");
      chat.addTools([
        {
          id: undefined as any,
          name: "test_tool",
          content: "result",
        },
      ]);

      const result = prepareRequest(chat);

      expect(Array.isArray(result.contents)).toBe(true);
      const contents = result.contents as any[];
      expect(contents[1].parts[0].functionResponse.id).toBeUndefined();
    });
  });

  describe("file type filtering", () => {
    it("should filter out unsupported file types", () => {
      const chat = new Chat();
      const imageFile: FileInfo = {
        path: "/path/to/image.jpg",
        base64: "imagedata==",
        mimeType: "image/jpeg",
        size: 1024,
        name: "image.jpg",
        type: "image",
      };

      const unsupportedFile: FileInfo = {
        path: "/path/to/video.mp4",
        base64: "videodata==",
        mimeType: "video/mp4",
        size: 5000,
        name: "video.mp4",
        type: "video" as any,
      };

      const content: ChatContent[] = [
        { type: "text", text: "Check these files" },
        { type: "file", file: imageFile },
        { type: "file", file: unsupportedFile },
      ];

      chat.messages.push({ role: "user", content });

      const result = prepareRequest(chat);

      expect(Array.isArray(result.contents)).toBe(true);
      const contents = result.contents as any[];
      expect(contents[0].parts).toHaveLength(2); // text + image (video filtered out)
      expect(contents[0].parts[0].text).toBe("Check these files");
      expect(contents[0].parts[1].inlineData).toBeDefined();
    });

    it("should handle various supported image formats", () => {
      const formats = [
        { mimeType: "image/jpeg", expected: "image/jpeg" },
        { mimeType: "image/png", expected: "image/png" },
        { mimeType: "image/gif", expected: "image/gif" },
        { mimeType: "image/webp", expected: "image/webp" },
      ];

      formats.forEach(({ mimeType, expected }) => {
        const chat = new Chat();
        const imageFile: FileInfo = {
          path: "/path/to/image",
          base64: "imagedata==",
          mimeType,
          size: 1024,
          name: "image",
          type: "image",
        };

        chat.addUser("Test image", [imageFile]);
        const result = prepareRequest(chat);

        expect(Array.isArray(result.contents)).toBe(true);
        const contents = result.contents as any[];
        expect(contents[0].parts[1].inlineData.mimeType).toBe(expected);
      });
    });
  });

  describe("assistant message handling", () => {
    it("should handle assistant message without tool calls", () => {
      const chat = new Chat();
      chat.addAssistant("Hello! How can I help you today?");

      const result = prepareRequest(chat);

      expect(Array.isArray(result.contents)).toBe(true);
      const contents = result.contents as any[];
      expect(contents[0]).toEqual({
        role: "assistant",
        parts: [{ text: "Hello! How can I help you today?" }],
      });
    });

    it("should handle assistant message with empty content and tool calls", () => {
      const chat = new Chat();
      const toolCalls: ToolCall[] = [
        {
          id: "call_123",
          name: "test_tool",
          arguments: {},
        },
      ];

      chat.addAssistant("", toolCalls);
      const result = prepareRequest(chat);

      expect(Array.isArray(result.contents)).toBe(true);
      const contents = result.contents as any[];
      expect(contents[0].role).toBe("assistant");
      expect(contents[0].parts).toHaveLength(2); // Empty text + tool call
      expect(contents[0].parts[0].text).toBe("");
      expect(contents[0].parts[1].functionCall).toBeDefined();
    });
  });

  describe("edge cases", () => {
    it("should handle empty chat", () => {
      const chat = new Chat();

      const result = prepareRequest(chat);

      expect(result.contents).toEqual([]);
      expect(result.config).toEqual({});
    });

    it("should handle malformed JSON in tool call arguments", () => {
      const chat = new Chat();
      chat.addUser("Hello");

      const toolCalls: ToolCall[] = [
        {
          id: "call_1",
          name: "test_tool",
          arguments: '{"invalid": json}',
        },
      ];

      // This should throw when JSON.parse is called
      expect(() => {
        chat.addAssistant("Using tool", toolCalls);
        prepareRequest(chat);
      }).toThrow();
    });

    it("should handle user message with empty content array", () => {
      const chat = new Chat();
      chat.messages.push({ role: "user", content: [] });

      const result = prepareRequest(chat);

      expect(Array.isArray(result.contents)).toBe(true);
      const contents = result.contents as any[];
      expect(contents[0]).toEqual({
        role: "user",
        parts: [],
      });
    });
  });
});
