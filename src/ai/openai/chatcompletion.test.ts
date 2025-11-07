import { describe, expect, test } from "@jest/globals";
import { ToolSchema } from "../../tools/types.js";
import { FileInfo } from "../../utils/file.js";
import { Chat } from "../chat.js";
import {
  ChatContent,
  ChatContentFile,
  ChatContentInstructions,
  ChatContentText,
  ToolCall,
} from "../types.js";
import { prepareRequest } from "./chatcompetion.js";

describe("OpenAI ChatCompletion prepareRequest", () => {
  const testModel = "gpt-4";

  describe("basic chat configurations", () => {
    test("should handle empty chat", () => {
      const chat = new Chat();
      const result = prepareRequest(chat, testModel);

      expect(result.model).toBe(testModel);
      expect(result.messages).toEqual([]);
      expect(result.tools).toBeUndefined();
    });

    test("should handle chat with only system message", () => {
      const chat = new Chat();
      chat.addSystem("You are a helpful assistant");
      const result = prepareRequest(chat, testModel);

      expect(result.model).toBe(testModel);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({
        role: "system",
        content: "You are a helpful assistant",
      });
      expect(result.tools).toBeUndefined();
    });

    test("should handle chat with single user message", () => {
      const chat = new Chat();
      chat.addUser("Hello, how are you?");
      const result = prepareRequest(chat, testModel);

      expect(result.model).toBe(testModel);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({
        role: "user",
        content: "Hello, how are you?",
      });
    });

    test("should handle chat with system and user messages", () => {
      const chat = new Chat();
      chat.addSystem("You are a helpful assistant");
      chat.addUser("Hello, how are you?");
      const result = prepareRequest(chat, testModel);

      expect(result.model).toBe(testModel);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]).toEqual({
        role: "system",
        content: "You are a helpful assistant",
      });
      expect(result.messages[1]).toEqual({
        role: "user",
        content: "Hello, how are you?",
      });
    });

    test("should handle conversation with multiple exchanges", () => {
      const chat = new Chat();
      chat.addSystem("You are a helpful assistant");
      chat.addUser("What's the weather like?");
      chat.addAssistant("I don't have access to real-time weather data.");
      chat.addUser("That's okay, thanks!");
      const result = prepareRequest(chat, testModel);

      expect(result.model).toBe(testModel);
      expect(result.messages).toHaveLength(4);
      expect(result.messages[0].role).toBe("system");
      expect(result.messages[1].role).toBe("user");
      expect(result.messages[2].role).toBe("assistant");
      expect(result.messages[3].role).toBe("user");
    });
  });

  describe("multimodal content", () => {
    const mockImageFile: FileInfo = {
      path: "/test/image.jpg",
      base64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
      mimeType: "image/jpeg",
      size: 1000,
      name: "image.jpg",
      type: "image",
    };

    const mockDocumentFile: FileInfo = {
      path: "/test/document.pdf",
      base64: "JVBERi0xLjQKJdP0zOEKMS==",
      mimeType: "application/pdf",
      size: 2000,
      name: "document.pdf",
      type: "document",
    };

    test("should handle user message with image", () => {
      const chat = new Chat();
      chat.addUser("Analyze this image", [mockImageFile]);
      const result = prepareRequest(chat, testModel);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.role).toBe("user");
      expect(Array.isArray(message.content)).toBe(true);
      expect(message.content).toHaveLength(2);

      expect(message.content[0]).toEqual({
        type: "text",
        text: "Analyze this image",
      });

      expect(message.content[1]).toEqual({
        type: "image_url",
        image_url: {
          url: `data:${mockImageFile.mimeType};base64,${mockImageFile.base64}`,
        },
      });
    });

    test("should handle user message with document", () => {
      const chat = new Chat();
      chat.addUser("Review this document", [mockDocumentFile]);
      const result = prepareRequest(chat, testModel);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.role).toBe("user");
      expect(Array.isArray(message.content)).toBe(true);
      expect(message.content).toHaveLength(2);

      expect(message.content[0]).toEqual({
        type: "text",
        text: "Review this document",
      });

      expect(message.content[1]).toEqual({
        type: "file",
        file: {
          filename: mockDocumentFile.name,
          file_data: `data:${mockDocumentFile.mimeType};base64,${mockDocumentFile.base64}`,
        },
      });
    });

    test("should handle user message with multiple files", () => {
      const chat = new Chat();
      chat.addUser("Analyze these files", [mockImageFile, mockDocumentFile]);
      const result = prepareRequest(chat, testModel);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.content).toHaveLength(3); // text + image + document

      expect(message.content[0].type).toBe("text");
      expect(message.content[1].type).toBe("image_url");
      expect(message.content[2].type).toBe("file");
    });

    test("should handle mixed content with instructions", () => {
      const chat = new Chat();
      const mixedContent: ChatContent[] = [
        { type: "text", text: "Please analyze this data" } as ChatContentText,
        {
          type: "instructions",
          instructions: "Focus on the trends",
        } as ChatContentInstructions,
        { type: "file", file: mockImageFile } as ChatContentFile,
      ];

      chat.messages.push({ role: "user", content: mixedContent });
      const result = prepareRequest(chat, testModel);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.content).toHaveLength(2); // combined text+instructions + image

      expect(message.content[0]).toEqual({
        type: "text",
        text: "Please analyze this data\n\nFocus on the trends",
      });

      expect(message.content[1].type).toBe("image_url");
    });
  });

  describe("tool configurations", () => {
    const mockToolSchema: ToolSchema = {
      name: "get_weather",
      description: "Get current weather information",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "City name" },
          units: { type: "string", enum: ["celsius", "fahrenheit"] },
        },
        required: ["location"],
      },
    };

    const mockToolSchema2: ToolSchema = {
      name: "calculate",
      description: "Perform mathematical calculations",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "Mathematical expression",
          },
        },
        required: ["expression"],
      },
    };

    test("should handle chat with single tool", () => {
      const chat = new Chat();
      chat.setToolSchemas([mockToolSchema]);
      chat.addUser("What's the weather in Boston?");
      const result = prepareRequest(chat, testModel);

      expect(result.tools).toHaveLength(1);
      expect(result.tools![0]).toEqual({
        type: "function",
        function: mockToolSchema,
      });
    });

    test("should handle chat with multiple tools", () => {
      const chat = new Chat();
      chat.setToolSchemas([mockToolSchema, mockToolSchema2]);
      chat.addUser("What's the weather in Boston and calculate 2 + 2?");
      const result = prepareRequest(chat, testModel);

      expect(result.tools).toHaveLength(2);
      expect(result.tools![0]).toEqual({
        type: "function",
        function: mockToolSchema,
      });
      expect(result.tools![1]).toEqual({
        type: "function",
        function: mockToolSchema2,
      });
    });

    test("should handle assistant message with tool calls", () => {
      const chat = new Chat();
      const toolCalls: ToolCall[] = [
        {
          id: "call_123",
          name: "get_weather",
          arguments: JSON.stringify({ location: "Boston", units: "celsius" }),
        },
        {
          id: "call_456",
          name: "calculate",
          arguments: { expression: "2 + 2" },
        },
      ];

      chat.addAssistant("I'll help you with both requests.", toolCalls);
      const result = prepareRequest(chat, testModel);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.role).toBe("assistant");
      expect(message.content).toBe("I'll help you with both requests.");
      expect(message.toolCalls).toHaveLength(2);

      expect(message.toolCalls[0]).toEqual({
        type: "function",
        function: {
          name: "get_weather",
          arguments: JSON.stringify({ location: "Boston", units: "celsius" }),
        },
        id: "call_123",
      });

      expect(message.toolCalls[1]).toEqual({
        type: "function",
        function: {
          name: "calculate",
          arguments: JSON.stringify({ expression: "2 + 2" }),
        },
        id: "call_456",
      });
    });

    test("should handle tool call results", () => {
      const chat = new Chat();
      chat.addTools([
        {
          id: "call_123",
          name: "get_weather",
          content: "Temperature: 22°C, Sunny",
        },
        { id: "call_456", name: "calculate", content: "4" },
      ]);
      const result = prepareRequest(chat, testModel);

      expect(result.messages).toHaveLength(2);

      expect(result.messages[0]).toEqual({
        role: "tool",
        tool_call_id: "call_123",
        content: "Temperature: 22°C, Sunny",
      });

      expect(result.messages[1]).toEqual({
        role: "tool",
        tool_call_id: "call_456",
        content: "4",
      });
    });
  });

  describe("complex scenarios", () => {
    test("should handle complete conversation with tools and multimodal content", () => {
      const chat = new Chat();
      const mockTool: ToolSchema = {
        name: "analyze_image",
        description: "Analyze image content",
        parameters: {
          type: "object",
          properties: { description: { type: "string" } },
          required: ["description"],
        },
      };

      const mockImageFile: FileInfo = {
        path: "/test/chart.png",
        base64: "base64data==",
        mimeType: "image/png",
        size: 1500,
        name: "chart.png",
        type: "image",
      };

      // Set up complete scenario
      chat.addSystem(
        "You are an AI assistant with image analysis capabilities",
      );
      chat.setToolSchemas([mockTool]);
      chat.addUser("Please analyze this chart", [mockImageFile]);
      chat.addAssistant("I'll analyze this chart for you.", [
        {
          id: "call_789",
          name: "analyze_image",
          arguments: JSON.stringify({ description: "chart analysis" }),
        },
      ]);
      chat.addTools([
        {
          id: "call_789",
          name: "analyze_image",
          content: "This is a bar chart showing quarterly sales data",
        },
      ]);
      chat.addAssistant(
        "Based on the analysis, this chart shows quarterly sales data with an upward trend.",
      );

      const result = prepareRequest(chat, testModel);

      expect(result.model).toBe(testModel);
      expect(result.messages).toHaveLength(5); // system + user + assistant + tool + assistant
      expect(result.tools).toHaveLength(1);

      // Verify system message
      expect(result.messages[0]).toEqual({
        role: "system",
        content: "You are an AI assistant with image analysis capabilities",
      });

      // Verify user message with image
      const userMessage = result.messages[1] as any;
      expect(userMessage.role).toBe("user");
      expect(Array.isArray(userMessage.content)).toBe(true);
      expect(userMessage.content).toHaveLength(2);

      // Verify assistant message with tool call
      const assistantMessage = result.messages[2] as any;
      expect(assistantMessage.role).toBe("assistant");
      expect(assistantMessage.toolCalls).toHaveLength(1);

      // Verify tool result
      expect(result.messages[3]).toEqual({
        role: "tool",
        tool_call_id: "call_789",
        content: "This is a bar chart showing quarterly sales data",
      });

      // Verify final assistant message
      expect(result.messages[4]).toEqual({
        role: "assistant",
        content:
          "Based on the analysis, this chart shows quarterly sales data with an upward trend.",
      });
    });

    test("should handle edge case with empty assistant content", () => {
      const chat = new Chat();
      chat.addAssistant(""); // Empty content
      const result = prepareRequest(chat, testModel);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({
        role: "assistant",
        content: "",
      });
    });

    test("should handle edge case with assistant having only tool calls", () => {
      const chat = new Chat();
      const toolCalls: ToolCall[] = [
        { id: "call_123", name: "test_tool", arguments: "{}" },
      ];

      chat.addAssistant("", toolCalls); // Empty content but with tool calls
      const result = prepareRequest(chat, testModel);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.role).toBe("assistant");
      expect(message.content).toBe("");
      expect(message.toolCalls).toHaveLength(1);
    });

    test("should preserve message order in complex conversations", () => {
      const chat = new Chat();
      chat.addSystem("System prompt");
      chat.addUser("First user message");
      chat.addAssistant("First assistant message");
      chat.addUser("Second user message");
      chat.addAssistant("Second assistant message");

      const result = prepareRequest(chat, testModel);

      expect(result.messages).toHaveLength(5);
      expect(result.messages[0].role).toBe("system");
      expect(result.messages[1].role).toBe("user");
      expect(result.messages[2].role).toBe("assistant");
      expect(result.messages[3].role).toBe("user");
      expect(result.messages[4].role).toBe("assistant");
    });
  });

  describe("assistant message handling", () => {
    test("should handle assistant message without tool calls", () => {
      const chat = new Chat();
      chat.addAssistant("Hello! How can I help you today?");
      const result = prepareRequest(chat, testModel);

      expect(result.model).toBe(testModel);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({
        role: "assistant",
        content: "Hello! How can I help you today?",
      });
    });

    test("should handle assistant message with empty content and tool calls", () => {
      const chat = new Chat();
      const toolCalls: ToolCall[] = [
        {
          id: "call_123",
          name: "test_tool",
          arguments: {},
        },
      ];

      chat.addAssistant("", toolCalls);
      const result = prepareRequest(chat, testModel);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.role).toBe("assistant");
      expect(message.content).toBe("");
      expect(message.toolCalls).toHaveLength(1);
    });
  });

  describe("file type filtering", () => {
    test("should filter out unsupported file types", () => {
      const mockImageFile: FileInfo = {
        path: "/test/image.jpg",
        base64: "imagedata==",
        mimeType: "image/jpeg",
        size: 1000,
        name: "image.jpg",
        type: "image",
      };

      const mockUnsupportedFile: FileInfo = {
        path: "/test/video.mp4",
        base64: "videodata==",
        mimeType: "video/mp4",
        size: 5000,
        name: "video.mp4",
        type: "video" as any,
      };

      const chat = new Chat();
      const content: ChatContent[] = [
        { type: "text", text: "Check these files" } as ChatContentText,
        { type: "file", file: mockImageFile } as ChatContentFile,
        { type: "file", file: mockUnsupportedFile } as ChatContentFile,
      ];

      chat.messages.push({ role: "user", content });
      const result = prepareRequest(chat, testModel);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.content).toHaveLength(2); // text + image (video filtered out)

      expect(message.content[0].type).toBe("text");
      expect(message.content[1].type).toBe("image_url");
    });

    test("should handle various supported image formats", () => {
      const formats = [
        { mimeType: "image/jpeg", expected: "image/jpeg" },
        { mimeType: "image/png", expected: "image/png" },
        { mimeType: "image/gif", expected: "image/gif" },
        { mimeType: "image/webp", expected: "image/webp" },
      ];

      formats.forEach(({ mimeType, expected }) => {
        const chat = new Chat();
        const imageFile: FileInfo = {
          path: "/test/image",
          base64: "imagedata==",
          mimeType,
          size: 1000,
          name: "image",
          type: "image",
        };

        chat.addUser("Test image", [imageFile]);
        const result = prepareRequest(chat, testModel);

        const message = result.messages[0] as any;
        expect(message.content[1].image_url.url).toContain(
          `data:${expected};base64,`,
        );
      });
    });

    test("should handle multiple document types", () => {
      const mockPdfFile: FileInfo = {
        path: "/test/document.pdf",
        base64: "pdfdata==",
        mimeType: "application/pdf",
        size: 2000,
        name: "document.pdf",
        type: "document",
      };

      const mockWordDoc: FileInfo = {
        path: "/test/document.docx",
        base64: "worddata==",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 3000,
        name: "document.docx",
        type: "document",
      };

      const chat = new Chat();
      const content: ChatContent[] = [
        { type: "text", text: "Review documents" } as ChatContentText,
        { type: "file", file: mockPdfFile } as ChatContentFile,
        { type: "file", file: mockWordDoc } as ChatContentFile,
      ];

      chat.messages.push({ role: "user", content });
      const result = prepareRequest(chat, testModel);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.content).toHaveLength(3); // text + PDF + Word doc

      expect(message.content[0].type).toBe("text");
      expect(message.content[1].type).toBe("file");
      expect(message.content[2].type).toBe("file");
    });
  });

  describe("edge cases and error handling", () => {
    test("should handle user message with only files (no text)", () => {
      const mockImageFile: FileInfo = {
        path: "/test/image.jpg",
        base64: "base64data==",
        mimeType: "image/jpeg",
        size: 1000,
        name: "image.jpg",
        type: "image",
      };

      const chat = new Chat();
      const content: ChatContent[] = [
        { type: "file", file: mockImageFile } as ChatContentFile,
      ];

      chat.messages.push({ role: "user", content });
      const result = prepareRequest(chat, testModel);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.role).toBe("user");
      expect(message.content).toHaveLength(1);
      expect(message.content[0].type).toBe("image_url");
    });

    test("should handle user message with only instructions (no text)", () => {
      const chat = new Chat();
      const content: ChatContent[] = [
        {
          type: "instructions",
          instructions: "Be concise",
        } as ChatContentInstructions,
      ];

      chat.messages.push({ role: "user", content });
      const result = prepareRequest(chat, testModel);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.role).toBe("user");
      expect(message.content).toHaveLength(1);
      expect(message.content[0]).toEqual({
        type: "text",
        text: "Be concise",
      });
    });

    test("should handle tool call arguments as object vs string", () => {
      const chat = new Chat();
      const toolCallsWithObject: ToolCall[] = [
        {
          id: "call_123",
          name: "test_tool",
          arguments: { param1: "value1", param2: 42 },
        },
      ];
      const toolCallsWithString: ToolCall[] = [
        {
          id: "call_456",
          name: "test_tool",
          arguments: '{"param1": "value1", "param2": 42}',
        },
      ];

      chat.addAssistant("Testing object args", toolCallsWithObject);
      chat.addAssistant("Testing string args", toolCallsWithString);

      const result = prepareRequest(chat, testModel);

      expect(result.messages).toHaveLength(2);

      const message1 = result.messages[0] as any;
      expect(message1.toolCalls[0].function.arguments).toBe(
        '{"param1":"value1","param2":42}',
      );

      const message2 = result.messages[1] as any;
      expect(message2.toolCalls[0].function.arguments).toBe(
        '{"param1": "value1", "param2": 42}',
      );
    });

    test("should handle tool call without id", () => {
      const chat = new Chat();
      const toolCalls: ToolCall[] = [
        {
          id: "",
          name: "test_tool",
          arguments: "{}",
        },
      ];

      chat.addAssistant("Testing no id", toolCalls);
      const result = prepareRequest(chat, testModel);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.toolCalls[0]).toEqual({
        type: "function",
        function: {
          name: "test_tool",
          arguments: "{}",
        },
      });
      expect(message.toolCalls[0].id).toBeUndefined();
    });

    test("should handle mixed file types correctly", () => {
      const mockImageFile: FileInfo = {
        path: "/test/image.jpg",
        base64: "imagedata==",
        mimeType: "image/jpeg",
        size: 1000,
        name: "image.jpg",
        type: "image",
      };

      const mockDocFile: FileInfo = {
        path: "/test/doc.pdf",
        base64: "docdata==",
        mimeType: "application/pdf",
        size: 2000,
        name: "doc.pdf",
        type: "document",
      };

      const mockUnknownFile: FileInfo = {
        path: "/test/unknown.xyz",
        base64: "unknowndata==",
        mimeType: "application/octet-stream",
        size: 500,
        name: "unknown.xyz",
        type: "unknown" as any,
      };

      const chat = new Chat();
      const content: ChatContent[] = [
        { type: "text", text: "Analyze these files" } as ChatContentText,
        { type: "file", file: mockImageFile } as ChatContentFile,
        { type: "file", file: mockDocFile } as ChatContentFile,
        { type: "file", file: mockUnknownFile } as ChatContentFile,
      ];

      chat.messages.push({ role: "user", content });
      const result = prepareRequest(chat, testModel);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.content).toHaveLength(3); // text + image + document (unknown file filtered out)

      expect(message.content[0].type).toBe("text");
      expect(message.content[1].type).toBe("image_url");
      expect(message.content[2].type).toBe("file");
    });

    test("should handle empty content arrays", () => {
      const chat = new Chat();
      const content: ChatContent[] = [];

      chat.messages.push({ role: "user", content });
      const result = prepareRequest(chat, testModel);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.role).toBe("user");
      expect(message.content).toEqual([]);
    });

    test("should handle multiple text content blocks", () => {
      const chat = new Chat();
      const content: ChatContent[] = [
        { type: "text", text: "First text block" } as ChatContentText,
        { type: "text", text: "Second text block" } as ChatContentText,
        { type: "text", text: "Third text block" } as ChatContentText,
      ];

      chat.messages.push({ role: "user", content });
      const result = prepareRequest(chat, testModel);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.content).toHaveLength(1);
      expect(message.content[0]).toEqual({
        type: "text",
        text: "First text block\n\nSecond text block\n\nThird text block",
      });
    });

    test("should handle multiple instruction blocks", () => {
      const chat = new Chat();
      const content: ChatContent[] = [
        { type: "text", text: "Main content" } as ChatContentText,
        {
          type: "instructions",
          instructions: "First instruction",
        } as ChatContentInstructions,
        {
          type: "instructions",
          instructions: "Second instruction",
        } as ChatContentInstructions,
      ];

      chat.messages.push({ role: "user", content });
      const result = prepareRequest(chat, testModel);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.content).toHaveLength(1);
      expect(message.content[0]).toEqual({
        type: "text",
        text: "Main content\n\nFirst instruction\n\nSecond instruction",
      });
    });
  });
});
