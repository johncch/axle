import { describe, expect, test, vi } from "vitest";
import type { AxleToolCallMessage } from "../../src/messages/message.js";
import { convertToProviderMessages } from "../../src/providers/anthropic/utils.js";
import { convertAxleMessages } from "../../src/providers/chatcompletions/utils.js";
import { convertAxleMessagesToGemini } from "../../src/providers/gemini/utils.js";
import { convertAxleMessageToResponseInput } from "../../src/providers/openai/utils.js";
import type { FileResolver } from "../../src/utils/file.js";

describe("Provider rich tool result conversion", () => {
  const textOnlyToolMsg: AxleToolCallMessage = {
    role: "tool",
    id: "tool-msg-1",
    content: [
      {
        id: "call_1",
        name: "test_tool",
        content: "plain text result",
      },
    ],
  };

  const richToolMsg: AxleToolCallMessage = {
    role: "tool",
    id: "tool-msg-2",
    content: [
      {
        id: "call_1",
        name: "test_tool",
        content: [
          { type: "text", text: "Here is the image:" },
          {
            type: "file",
            file: {
              kind: "image",
              mimeType: "image/png",
              name: "tool-image.png",
              source: { type: "base64", data: "iVBORw0KGgo=" },
            },
          },
        ],
      },
    ],
  };

  describe("Anthropic", () => {
    test("converts text-only tool result unchanged", async () => {
      const result = await convertToProviderMessages([textOnlyToolMsg]);
      expect(result).toHaveLength(1);
      const msg = result[0];
      expect(msg.role).toBe("user");
      const content = (msg as any).content[0];
      expect(content.type).toBe("tool_result");
      expect(content.tool_use_id).toBe("call_1");
      expect(content.content).toBe("plain text result");
    });

    test("converts rich tool result to content blocks", async () => {
      const result = await convertToProviderMessages([richToolMsg]);
      expect(result).toHaveLength(1);
      const msg = result[0];
      const toolResult = (msg as any).content[0];
      expect(toolResult.type).toBe("tool_result");
      expect(toolResult.tool_use_id).toBe("call_1");

      // Content should be an array of blocks
      expect(Array.isArray(toolResult.content)).toBe(true);
      expect(toolResult.content).toHaveLength(2);
      expect(toolResult.content[0]).toEqual({ type: "text", text: "Here is the image:" });
      expect(toolResult.content[1]).toEqual({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "iVBORw0KGgo=",
        },
      });
    });
  });

  describe("OpenAI Responses API", () => {
    test("converts text-only tool result unchanged", async () => {
      const result = await convertAxleMessageToResponseInput([textOnlyToolMsg]);
      expect(result).toHaveLength(1);
      const msg = result[0] as any;
      expect(msg.type).toBe("function_call_output");
      expect(msg.call_id).toBe("call_1");
      expect(msg.output).toBe("plain text result");
    });

    test("converts rich tool result to content array", async () => {
      const result = await convertAxleMessageToResponseInput([richToolMsg]);
      expect(result).toHaveLength(1);
      const msg = result[0] as any;
      expect(msg.type).toBe("function_call_output");
      expect(Array.isArray(msg.output)).toBe(true);
      expect(msg.output).toHaveLength(2);
      expect(msg.output[0]).toEqual({ type: "input_text", text: "Here is the image:" });
      expect(msg.output[1]).toEqual({
        type: "input_image",
        image_url: "data:image/png;base64,iVBORw0KGgo=",
        detail: "auto",
      });
    });
  });

  describe("ChatCompletions", () => {
    test("converts binary tool-result files to model-visible compatibility errors", async () => {
      const warn = vi.fn();

      const result = await convertAxleMessages([richToolMsg], undefined, {
        model: "chat-test",
        warn,
      });

      expect(result).toEqual([
        {
          role: "tool",
          tool_call_id: "call_1",
          content:
            'Here is the image:\nTool result attachment unavailable.\nFile: tool-image.png\nMIME type: image/png\n\nThis tool returned a file of kind "image", but Chat Completions tool-result messages support text only. The file content was not included. Continue without the file or ask for it to be attached in a user message.',
        },
      ]);
      expect(warn).toHaveBeenCalledWith("ChatCompletions omitted unsupported tool-result file", {
        model: "chat-test",
        kind: "image",
        name: "tool-image.png",
        mimeType: "image/png",
      });
    });
  });

  describe("deferred file sources", () => {
    const deferredImageToolMsg: AxleToolCallMessage = {
      role: "tool",
      id: "tool-msg-deferred-image",
      content: [
        {
          id: "call_deferred_image",
          name: "read_file",
          content: [
            {
              type: "file",
              file: {
                kind: "image",
                mimeType: "image/png",
                name: "deferred.png",
                source: { type: "ref", ref: { id: "image-1" } },
              },
            },
          ],
        },
      ],
    };

    test("Anthropic resolves deferred tool-result images", async () => {
      const resolver = createImageResolver();

      const result = await convertToProviderMessages([deferredImageToolMsg], {
        model: "claude-test",
        fileResolver: resolver,
      });

      expect(resolver).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "anthropic",
          model: "claude-test",
          ref: { id: "image-1" },
        }),
      );
      expect((result[0] as any).content[0].content[0]).toEqual({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "resolved-image",
        },
      });
    });

    test("OpenAI resolves deferred tool-result images", async () => {
      const resolver = createImageResolver();

      const result = await convertAxleMessageToResponseInput([deferredImageToolMsg], {
        model: "gpt-test",
        fileResolver: resolver,
      });

      expect(resolver).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "openai",
          model: "gpt-test",
          ref: { id: "image-1" },
        }),
      );
      expect((result[0] as any).output[0]).toEqual({
        type: "input_image",
        image_url: "data:image/png;base64,resolved-image",
        detail: "auto",
      });
    });

    test("Gemini resolves deferred tool-result images", async () => {
      const resolver = createImageResolver();

      const result = await convertAxleMessagesToGemini([deferredImageToolMsg], {
        model: "gemini-test",
        fileResolver: resolver,
      });

      expect(resolver).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "gemini",
          model: "gemini-test",
          ref: { id: "image-1" },
        }),
      );
      expect(result[0].parts?.[1]).toEqual({
        inlineData: {
          mimeType: "image/png",
          data: "resolved-image",
        },
      });
    });

    test("ChatCompletions resolves deferred text tool-result files", async () => {
      const resolver = vi.fn(async (request: Parameters<FileResolver>[0]) => {
        expect(request.accepted).toEqual(["text"]);
        return { type: "text" as const, content: "resolved text" };
      });
      const deferredTextToolMsg: AxleToolCallMessage = {
        role: "tool",
        id: "tool-msg-deferred-text",
        content: [
          {
            id: "call_deferred_text",
            name: "read_file",
            content: [
              {
                type: "file",
                file: {
                  kind: "text",
                  mimeType: "text/plain",
                  name: "deferred.txt",
                  source: { type: "ref", ref: { id: "text-1" } },
                },
              },
            ],
          },
        ],
      };

      const result = await convertAxleMessages([deferredTextToolMsg], undefined, {
        model: "chat-test",
        fileResolver: resolver,
      });

      expect(resolver).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "chatcompletions",
          model: "chat-test",
          ref: { id: "text-1" },
        }),
      );
      expect(result[0]).toEqual({
        role: "tool",
        tool_call_id: "call_deferred_text",
        content: "File: deferred.txt\nMIME type: text/plain\n\nresolved text",
      });
    });

    test("ChatCompletions does not resolve unsupported deferred tool-result images", async () => {
      const resolver = createImageResolver();

      const result = await convertAxleMessages([deferredImageToolMsg], undefined, {
        model: "chat-test",
        fileResolver: resolver,
      });

      expect(resolver).not.toHaveBeenCalled();
      expect(result[0]).toEqual({
        role: "tool",
        tool_call_id: "call_deferred_image",
        content:
          'Tool result attachment unavailable.\nFile: deferred.png\nMIME type: image/png\n\nThis tool returned a file of kind "image", but Chat Completions tool-result messages support text only. The file content was not included. Continue without the file or ask for it to be attached in a user message.',
      });
    });
  });
});

function createImageResolver() {
  return vi.fn(async (request: Parameters<FileResolver>[0]) => {
    expect(request.accepted).toContain("base64");
    return { type: "base64" as const, data: "resolved-image" };
  });
}
