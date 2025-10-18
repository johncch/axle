import { describe, expect, test } from "@jest/globals";
import { Chat } from "../../messages/chat.js";
import {
  ContentPart,
  ContentPartFile,
  ContentPartInstructions,
  ContentPartText,
  ContentPartToolCall,
} from "../../messages/types.js";
import { ToolSchema } from "../../tools/types.js";
import { FileInfo } from "../../utils/file.js";
import { AxleStopReason } from "../types.js";
import { prepareRequest } from "./utils.js";

describe("Anthropic prepareRequest", () => {
  describe("basic chat configurations", () => {
    test("should handle empty chat", () => {
      const chat = new Chat();
      const result = prepareRequest(chat);

      expect(result.messages).toEqual([]);
      expect(result.tools).toEqual([]);
      expect(result.system).toBeUndefined();
    });

    test("should handle chat with only system message", () => {
      const chat = new Chat();
      chat.addSystem("You are a helpful assistant");
      const result = prepareRequest(chat);

      expect(result.system).toBe("You are a helpful assistant");
      expect(result.messages).toEqual([]);
      expect(result.tools).toEqual([]);
    });

    test("should handle chat with single user message", () => {
      const chat = new Chat();
      chat.addUser("Hello, how are you?");
      const result = prepareRequest(chat);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({
        role: "user",
        content: "Hello, how are you?",
      });
      expect(result.system).toBeUndefined();
    });

    test("should handle chat with system and user messages", () => {
      const chat = new Chat();
      chat.addSystem("You are a helpful assistant");
      chat.addUser("Hello, how are you?");
      const result = prepareRequest(chat);

      expect(result.system).toBe("You are a helpful assistant");
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({
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
      const result = prepareRequest(chat);

      expect(result.system).toBe("You are a helpful assistant");
      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].role).toBe("user");
      expect(result.messages[1].role).toBe("assistant");
      expect(result.messages[2].role).toBe("user");
    });
  });

  describe("assistant messages", () => {
    test("should handle assistant message without tool calls", () => {
      const chat = new Chat();
      chat.addAssistant("Hello! How can I help you today?");
      const result = prepareRequest(chat);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello! How can I help you today?",
          },
        ],
      });
    });

    test("should handle assistant message with tool calls", () => {
      const chat = new Chat();
      const toolCalls: ContentPartToolCall[] = [
        {
          type: "tool-call",
          id: "call_123",
          name: "get_weather",
          arguments: { location: "Boston", units: "celsius" },
        },
        {
          type: "tool-call",
          id: "call_456",
          name: "calculate",
          arguments: { expression: "2 + 2" },
        },
      ];

      chat.addAssistant({
        id: crypto.randomUUID(),
        model: "test",
        content: [{ type: "text", text: "I'll help you with both requests." }],
        finishReason: AxleStopReason.FunctionCall,
        toolCalls,
      });
      const result = prepareRequest(chat);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.role).toBe("assistant");
      expect(message.content).toHaveLength(3);

      expect(message.content[0]).toEqual({
        type: "text",
        text: "I'll help you with both requests.",
      });

      expect(message.content[1]).toEqual({
        type: "tool_use",
        id: "call_123",
        name: "get_weather",
        input: { location: "Boston", units: "celsius" },
      });

      expect(message.content[2]).toEqual({
        type: "tool_use",
        id: "call_456",
        name: "calculate",
        input: { expression: "2 + 2" },
      });
    });

    test("should handle assistant message with empty content and tool calls", () => {
      const chat = new Chat();
      const toolCalls: ContentPartToolCall[] = [
        {
          type: "tool-call",
          id: "call_123",
          name: "test_tool",
          arguments: {},
        },
      ];

      chat.addAssistant({
        id: crypto.randomUUID(),
        model: "test",
        content: [{ type: "text", text: "" }],
        finishReason: AxleStopReason.FunctionCall,
        toolCalls,
      });
      const result = prepareRequest(chat);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.role).toBe("assistant");
      expect(message.content).toHaveLength(2);
      expect(message.content[0].text).toBe("");
      expect(message.content[1].type).toBe("tool_use");
    });
  });

  describe("tool call results", () => {
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
      const result = prepareRequest(chat);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.role).toBe("user");
      expect(Array.isArray(message.content)).toBe(true);
      expect(message.content).toHaveLength(2);

      expect(message.content[0]).toEqual({
        type: "tool_result",
        tool_use_id: "call_123",
        content: "Temperature: 22°C, Sunny",
      });

      expect(message.content[1]).toEqual({
        type: "tool_result",
        tool_use_id: "call_456",
        content: "4",
      });
    });

    test("should handle single tool call result", () => {
      const chat = new Chat();
      chat.addTools([{ id: "call_789", name: "search", content: "Found 3 results" }]);
      const result = prepareRequest(chat);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.role).toBe("user");
      expect(message.content).toHaveLength(1);
      expect(message.content[0]).toEqual({
        type: "tool_result",
        tool_use_id: "call_789",
        content: "Found 3 results",
      });
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

    const mockPdfFile: FileInfo = {
      path: "/test/document.pdf",
      base64: "JVBERi0xLjQKJdP0zOEKMS==",
      mimeType: "application/pdf",
      size: 2000,
      name: "document.pdf",
      type: "document",
    };

    const mockPngImage: FileInfo = {
      path: "/test/image.png",
      base64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      mimeType: "image/png",
      size: 800,
      name: "image.png",
      type: "image",
    };

    test("should handle user message with JPEG image", () => {
      const chat = new Chat();
      chat.addUser("Analyze this image", [mockImageFile]);
      const result = prepareRequest(chat);

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
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: mockImageFile.base64,
        },
      });
    });

    test("should handle user message with PNG image", () => {
      const chat = new Chat();
      chat.addUser("Look at this PNG", [mockPngImage]);
      const result = prepareRequest(chat);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.content[1]).toEqual({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: mockPngImage.base64,
        },
      });
    });

    test("should handle user message with PDF document", () => {
      const chat = new Chat();
      chat.addUser("Review this document", [mockPdfFile]);
      const result = prepareRequest(chat);

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
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: mockPdfFile.base64,
        },
      });
    });

    test("should handle user message with multiple files", () => {
      const chat = new Chat();
      chat.addUser("Analyze these files", [mockImageFile, mockPdfFile]);
      const result = prepareRequest(chat);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.content).toHaveLength(3); // text + image + document

      expect(message.content[0].type).toBe("text");
      expect(message.content[1].type).toBe("image");
      expect(message.content[2].type).toBe("document");
    });

    test("should handle mixed content with text and instructions", () => {
      const chat = new Chat();
      const content: ContentPart[] = [
        { type: "text", text: "Please analyze this data" } as ContentPartText,
        {
          type: "instructions",
          instructions: "Focus on the trends",
        } as ContentPartInstructions,
        { type: "file", file: mockImageFile } as ContentPartFile,
      ];

      chat.messages.push({ role: "user", content });
      const result = prepareRequest(chat);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.role).toBe("user");
      expect(message.content).toHaveLength(2); // text (combined) + image

      expect(message.content[0]).toEqual({
        type: "text",
        text: "Please analyze this data\n\nFocus on the trends",
      });

      expect(message.content[1].type).toBe("image");
    });

    test("should filter out unsupported file types", () => {
      const mockUnsupportedFile: FileInfo = {
        path: "/test/video.mp4",
        base64: "videodata==",
        mimeType: "video/mp4",
        size: 5000,
        name: "video.mp4",
        type: "video" as any,
      };

      const chat = new Chat();
      const content: ContentPart[] = [
        { type: "text", text: "Check these files" } as ContentPartText,
        { type: "file", file: mockImageFile } as ContentPartFile,
        { type: "file", file: mockUnsupportedFile } as ContentPartFile,
        { type: "file", file: mockPdfFile } as ContentPartFile,
      ];

      chat.messages.push({ role: "user", content });
      const result = prepareRequest(chat);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.content).toHaveLength(3); // text + image + document (video filtered out)

      expect(message.content[0].type).toBe("text");
      expect(message.content[1].type).toBe("image");
      expect(message.content[2].type).toBe("document");
    });

    test("should handle non-PDF documents by filtering them out", () => {
      const mockWordDoc: FileInfo = {
        path: "/test/document.docx",
        base64: "worddata==",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 3000,
        name: "document.docx",
        type: "document",
      };

      const chat = new Chat();
      const content: ContentPart[] = [
        { type: "text", text: "Review documents" } as ContentPartText,
        { type: "file", file: mockPdfFile } as ContentPartFile,
        { type: "file", file: mockWordDoc } as ContentPartFile,
      ];

      chat.messages.push({ role: "user", content });
      const result = prepareRequest(chat);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.content).toHaveLength(2); // text + PDF only (Word doc filtered out)

      expect(message.content[0].type).toBe("text");
      expect(message.content[1].type).toBe("document");
      expect(message.content[1].source.media_type).toBe("application/pdf");
    });

    test("should handle content with only files (no text)", () => {
      const chat = new Chat();
      const content: ContentPart[] = [{ type: "file", file: mockImageFile } as ContentPartFile];

      chat.messages.push({ role: "user", content });
      const result = prepareRequest(chat);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.role).toBe("user");
      expect(message.content).toHaveLength(1);
      expect(message.content[0].type).toBe("image");
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
      const result = prepareRequest(chat);

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]).toEqual({
        name: "get_weather",
        description: "Get current weather information",
        input_schema: {
          type: "object",
          properties: {
            location: { type: "string", description: "City name" },
            units: { type: "string", enum: ["celsius", "fahrenheit"] },
          },
          required: ["location"],
        },
      });
    });

    test("should handle chat with multiple tools", () => {
      const chat = new Chat();
      chat.setToolSchemas([mockToolSchema, mockToolSchema2]);
      chat.addUser("What's the weather in Boston and calculate 2 + 2?");
      const result = prepareRequest(chat);

      expect(result.tools).toHaveLength(2);
      expect(result.tools[0].name).toBe("get_weather");
      expect(result.tools[0].description).toBe("Get current weather information");
      expect(result.tools[0].input_schema).toEqual(mockToolSchema.parameters);

      expect(result.tools[1].name).toBe("calculate");
      expect(result.tools[1].description).toBe("Perform mathematical calculations");
      expect(result.tools[1].input_schema).toEqual(mockToolSchema2.parameters);
    });

    test("should handle empty tools array", () => {
      const chat = new Chat();
      chat.setToolSchemas([]);
      chat.addUser("Hello");
      const result = prepareRequest(chat);

      expect(result.tools).toEqual([]);
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
      chat.addSystem("You are an AI assistant with image analysis capabilities");
      chat.setToolSchemas([mockTool]);
      chat.addUser("Please analyze this chart", [mockImageFile]);
      chat.addAssistant({
        id: crypto.randomUUID(),
        model: "test",
        content: [{ type: "text", text: "I'll analyze this chart for you." }],
        finishReason: AxleStopReason.FunctionCall,
        toolCalls: [
          {
            type: "tool-call",
            id: "call_789",
            name: "analyze_chart",
            arguments: { image_path: "/test/chart.png" },
          },
        ],
      });
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

      const result = prepareRequest(chat);

      expect(result.system).toBe("You are an AI assistant with image analysis capabilities");
      expect(result.messages).toHaveLength(4); // user + assistant + tool + assistant
      expect(result.tools).toHaveLength(1);

      // Verify user message with image
      const userMessage = result.messages[0] as any;
      expect(userMessage.role).toBe("user");
      expect(Array.isArray(userMessage.content)).toBe(true);
      expect(userMessage.content).toHaveLength(2);

      // Verify assistant message with tool call
      const assistantMessage = result.messages[1] as any;
      expect(assistantMessage.role).toBe("assistant");
      expect(assistantMessage.content).toHaveLength(2); // text + tool_use
      expect(assistantMessage.content[1].type).toBe("tool_use");

      // Verify tool result
      const toolMessage = result.messages[2] as any;
      expect(toolMessage.role).toBe("user");
      expect(toolMessage.content[0]).toEqual({
        type: "tool_result",
        tool_use_id: "call_789",
        content: "This is a bar chart showing quarterly sales data",
      });

      // Verify final assistant message
      const finalMessage = result.messages[3] as any;
      expect(finalMessage.role).toBe("assistant");
      expect(finalMessage.content[0].text).toBe(
        "Based on the analysis, this chart shows quarterly sales data with an upward trend.",
      );
    });

    test("should preserve message order in complex conversations", () => {
      const chat = new Chat();
      chat.addSystem("System prompt");
      chat.addUser("First user message");
      chat.addAssistant("First assistant message");
      chat.addUser("Second user message");
      chat.addAssistant("Second assistant message");

      const result = prepareRequest(chat);

      expect(result.system).toBe("System prompt");
      expect(result.messages).toHaveLength(4);
      expect(result.messages[0].role).toBe("user");
      expect(result.messages[1].role).toBe("assistant");
      expect(result.messages[2].role).toBe("user");
      expect(result.messages[3].role).toBe("assistant");
    });
  });

  describe("conversation flow handling", () => {
    test("should handle conversation ending with assistant message", () => {
      const chat = new Chat();
      chat.addSystem("You are helpful");
      chat.addUser("Hello");
      chat.addAssistant("Hi there!");

      const result = prepareRequest(chat);

      expect(result.system).toBe("You are helpful");
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe("user");
      expect(result.messages[1].role).toBe("assistant");
    });

    test("should handle conversation ending with user message", () => {
      const chat = new Chat();
      chat.addSystem("You are helpful");
      chat.addUser("Hello");
      chat.addAssistant("Hi there!");
      chat.addUser("Thanks!");

      const result = prepareRequest(chat);

      expect(result.system).toBe("You are helpful");
      expect(result.messages).toHaveLength(3);
      expect(result.messages[2].role).toBe("user");
    });

    test("should handle empty system message", () => {
      const chat = new Chat();
      chat.addSystem(""); // Empty system
      chat.addUser("Hello");

      const result = prepareRequest(chat);

      expect(result.system).toBe("");
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("user");
    });
  });

  describe("malformed data handling", () => {
    test("should handle tool calls with string arguments that are JSON", () => {
      const chat = new Chat();
      const toolCalls: ContentPartToolCall[] = [
        {
          type: "tool-call",
          id: "call_123",
          name: "test_tool",
          arguments: '{"param": "value"}',
        },
      ];

      chat.addAssistant({
        id: crypto.randomUUID(),
        model: "test",
        content: [{ type: "text", text: "Using tool" }],
        finishReason: AxleStopReason.FunctionCall,
        toolCalls,
      });
      const result = prepareRequest(chat);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.content[1]).toEqual({
        type: "tool_use",
        id: "call_123",
        name: "test_tool",
        input: '{"param": "value"}',
      });
    });

    test("should handle empty tool schemas array", () => {
      const chat = new Chat();
      chat.setToolSchemas([]);
      chat.addUser("Hello");
      const result = prepareRequest(chat);

      expect(result.tools).toEqual([]);
    });
  });

  describe("edge cases", () => {
    test("should handle empty content arrays", () => {
      const chat = new Chat();
      const content: ContentPart[] = [];

      chat.messages.push({ role: "user", content });
      const result = prepareRequest(chat);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.role).toBe("user");
      expect(message.content).toEqual([]);
    });

    test("should handle multiple text content blocks", () => {
      const chat = new Chat();
      const content: ContentPart[] = [
        { type: "text", text: "First text block" } as ContentPartText,
        { type: "text", text: "Second text block" } as ContentPartText,
        { type: "text", text: "Third text block" } as ContentPartText,
      ];

      chat.messages.push({ role: "user", content });
      const result = prepareRequest(chat);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.content).toHaveLength(1);
      expect(message.content[0]).toEqual({
        type: "text",
        text: "First text block\n\nSecond text block\n\nThird text block",
      });
    });

    test("should handle tool calls with string arguments", () => {
      const chat = new Chat();
      const toolCalls: ContentPartToolCall[] = [
        {
          type: "tool-call",
          id: "call_123",
          name: "test_tool",
          arguments: '{"param": "value"}',
        },
      ];

      chat.addAssistant({
        id: crypto.randomUUID(),
        model: "test",
        content: [{ type: "text", text: "Using tool" }],
        finishReason: AxleStopReason.FunctionCall,
        toolCalls,
      });
      const result = prepareRequest(chat);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.content[1]).toEqual({
        type: "tool_use",
        id: "call_123",
        name: "test_tool",
        input: '{"param": "value"}',
      });
    });

    test("should handle tool calls with object arguments", () => {
      const chat = new Chat();
      const toolCalls: ContentPartToolCall[] = [
        {
          type: "tool-call",
          id: "call_456",
          name: "test_tool",
          arguments: { param: "value", number: 42 },
        },
      ];

      chat.addAssistant({
        id: crypto.randomUUID(),
        model: "test",
        content: [{ type: "text", text: "Using tool" }],
        finishReason: AxleStopReason.FunctionCall,
        toolCalls,
      });
      const result = prepareRequest(chat);

      expect(result.messages).toHaveLength(1);
      const message = result.messages[0] as any;
      expect(message.content[1]).toEqual({
        type: "tool_use",
        id: "call_456",
        name: "test_tool",
        input: { param: "value", number: 42 },
      });
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
        const result = prepareRequest(chat);

        const message = result.messages[0] as any;
        expect(message.content[1].source.media_type).toBe(expected);
      });
    });
  });
});
