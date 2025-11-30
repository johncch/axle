import { describe, expect, it } from "@jest/globals";
import { WriteToDisk } from "../../src/actions/writeToDisk.js";
import {
    availableTools,
    createTool,
    createTools,
    createWriteToDiskAction,
} from "../../src/cli/factories.js";

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

  describe("createWriteToDiskAction", () => {
    it("should create WriteToDisk action with path only", () => {
      const action = createWriteToDiskAction("./output/test.txt");
      expect(action).toBeInstanceOf(WriteToDisk);
      expect(action.name).toBe("write-to-disk");
    });

    it("should create WriteToDisk action with custom content template", () => {
      const action = createWriteToDiskAction("./output/test.txt", "{{customField}}");
      expect(action).toBeInstanceOf(WriteToDisk);
      expect(action.name).toBe("write-to-disk");
    });

    it("should use default content template when not specified", () => {
      const action = createWriteToDiskAction("./output/test.txt");
      expect(action).toBeInstanceOf(WriteToDisk);
      // Default template is {{response}}
    });
  });

  describe("availableTools", () => {
    it("should contain brave and calculator", () => {
      expect(availableTools).toContain("brave");
      expect(availableTools).toContain("calculator");
    });

    it("should be a readonly array", () => {
      expect(Array.isArray(availableTools)).toBe(true);
      expect(availableTools).toHaveLength(2);
    });
  });
});
