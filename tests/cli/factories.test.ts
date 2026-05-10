import { describe, expect, it } from "vitest";
import { availableTools, createTool, createTools } from "../../src/cli/tools.js";

describe("CLI Factories", () => {
  describe("createTool", () => {
    it("should create brave tool", () => {
      const tool = createTool("brave");
      expect(tool.name).toBe("brave");
      expect(tool.description).toContain("Brave");
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

  });

  describe("createTools", () => {
    it("should create multiple tools", () => {
      const tools = createTools(["brave", "exec"]);
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("brave");
      expect(tools[1].name).toBe("exec");
    });

    it("should create empty array for empty input", () => {
      const tools = createTools([]);
      expect(tools).toHaveLength(0);
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

  });
});
