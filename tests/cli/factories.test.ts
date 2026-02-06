import { describe, expect, it } from "vitest";
import type { ToolProviderConfig } from "../../src/cli/configs/schemas.js";
import { availableTools, createTool, createTools } from "../../src/cli/tools.js";

describe("CLI Factories", () => {
  describe("createTool", () => {
    it("should create brave tool", () => {
      const tool = createTool("brave");
      expect(tool.name).toBe("brave");
      expect(tool.description).toContain("Brave");
      expect(tool.schema).toBeDefined();
    });

    it("should create calculator tool", () => {
      const tool = createTool("calculator");
      expect(tool.name).toBe("calculator");
      expect(tool.description).toContain("arithmetic");
      expect(tool.schema).toBeDefined();
    });

    it("should create exec tool", () => {
      const tool = createTool("exec");
      expect(tool.name).toBe("exec");
      expect(tool.description).toContain("shell command");
      expect(tool.schema).toBeDefined();
    });

    it("should throw error for unknown tool", () => {
      expect(() => createTool("unknown-tool")).toThrow("Unknown tool: unknown-tool");
    });

    it("should configure brave tool with config", () => {
      const config = {
        brave: {
          "api-key": "test-api-key",
          rateLimit: 5,
        },
      };

      const tool = createTool("brave", config);
      expect(tool.name).toBe("brave");
      // Tool should be configured (we can't easily test internal state)
    });

    it("should configure exec tool with config", () => {
      const config: ToolProviderConfig = {
        exec: {
          timeout: 5000,
        },
      };

      const tool = createTool("exec", config);
      expect(tool.name).toBe("exec");
    });

    it("should handle missing config gracefully", () => {
      const tool = createTool("brave", undefined);
      expect(tool.name).toBe("brave");
    });

    it("should handle empty config gracefully", () => {
      const tool = createTool("calculator", {});
      expect(tool.name).toBe("calculator");
    });
  });

  describe("createTools", () => {
    it("should create multiple tools", () => {
      const tools = createTools(["brave", "calculator"]);
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("brave");
      expect(tools[1].name).toBe("calculator");
    });

    it("should create empty array for empty input", () => {
      const tools = createTools([]);
      expect(tools).toHaveLength(0);
    });

    it("should create single tool", () => {
      const tools = createTools(["calculator"]);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("calculator");
    });

    it("should apply config to all tools", () => {
      const config = {
        brave: {
          "api-key": "test-key",
        },
      };

      const tools = createTools(["brave", "calculator"], config);
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("brave");
      expect(tools[1].name).toBe("calculator");
    });

    it("should throw if any tool name is unknown", () => {
      expect(() => createTools(["brave", "unknown"])).toThrow("Unknown tool: unknown");
    });
  });

  describe("availableTools", () => {
    it("should contain all available tools", () => {
      expect(availableTools).toContain("brave");
      expect(availableTools).toContain("calculator");
      expect(availableTools).toContain("exec");
      expect(availableTools).toContain("patch-file");
      expect(availableTools).toContain("read-file");
      expect(availableTools).toContain("write-file");
    });

    it("should be a readonly array", () => {
      expect(Array.isArray(availableTools)).toBe(true);
      expect(availableTools).toHaveLength(6);
    });
  });
});
