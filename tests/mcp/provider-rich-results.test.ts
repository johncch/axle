import { describe, expect, test } from "vitest";
import type { AxleToolCallMessage } from "../../src/messages/message.js";
import { convertToProviderMessages } from "../../src/providers/anthropic/utils.js";
import { convertAxleMessageToResponseInput } from "../../src/providers/openai/utils.js";

describe("Provider rich tool result conversion", () => {
  const textOnlyToolMsg: AxleToolCallMessage = {
    role: "tool",
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
    content: [
      {
        id: "call_1",
        name: "test_tool",
        content: [
          { type: "text", text: "Here is the image:" },
          { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
        ],
      },
    ],
  };

  describe("Anthropic", () => {
    test("converts text-only tool result unchanged", () => {
      const result = convertToProviderMessages([textOnlyToolMsg]);
      expect(result).toHaveLength(1);
      const msg = result[0];
      expect(msg.role).toBe("user");
      const content = (msg as any).content[0];
      expect(content.type).toBe("tool_result");
      expect(content.tool_use_id).toBe("call_1");
      expect(content.content).toBe("plain text result");
    });

    test("converts rich tool result to content blocks", () => {
      const result = convertToProviderMessages([richToolMsg]);
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
    test("converts text-only tool result unchanged", () => {
      const result = convertAxleMessageToResponseInput([textOnlyToolMsg]);
      expect(result).toHaveLength(1);
      const msg = result[0] as any;
      expect(msg.type).toBe("function_call_output");
      expect(msg.call_id).toBe("call_1");
      expect(msg.output).toBe("plain text result");
    });

    test("converts rich tool result to content array", () => {
      const result = convertAxleMessageToResponseInput([richToolMsg]);
      expect(result).toHaveLength(1);
      const msg = result[0] as any;
      expect(msg.type).toBe("function_call_output");
      expect(Array.isArray(msg.output)).toBe(true);
      expect(msg.output).toHaveLength(2);
      expect(msg.output[0]).toEqual({ type: "input_text", text: "Here is the image:" });
      expect(msg.output[1]).toEqual({
        type: "input_image",
        image_url: "data:image/png;base64,iVBORw0KGgo=",
      });
    });
  });
});
