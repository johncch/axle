import { beforeEach, describe, expect, it } from "vitest";
import execTool from "../../src/tools/exec.js";

describe("ExecTool", () => {
  beforeEach(() => {
    // Reset the tool state before each test
    execTool.configure({});
  });

  describe("basic properties", () => {
    it("should have correct name", () => {
      expect(execTool.name).toBe("exec");
    });

    it("should have a description", () => {
      expect(execTool.description).toContain("shell command");
    });

    it("should have a schema with command parameter", () => {
      expect(execTool.schema).toBeDefined();
      const shape = execTool.schema.shape;
      expect(shape.command).toBeDefined();
    });
  });

  describe("command execution", () => {
    it("should return stdout from successful command", async () => {
      const result = await execTool.execute({ command: "echo hello" });
      expect(result).toBe("hello\n");
    });

    it("should include stderr when present", async () => {
      const result = await execTool.execute({
        command: 'sh -c "echo error >&2"',
      });
      expect(result).toContain("error");
    });

    it("should handle commands that fail", async () => {
      const result = await execTool.execute({ command: "false" });
      expect(result).toContain("Error");
    });

    it("should handle commands that don't exist", async () => {
      const result = await execTool.execute({ command: "nonexistent-command-xyz" });
      expect(result).toContain("Error");
    });
  });

  describe("configuration options", () => {
    it("should respect timeout configuration", async () => {
      execTool.configure({
        timeout: 100, // 100ms timeout
      });

      const result = await execTool.execute({ command: "sleep 5" });
      expect(result).toContain("Error");
    });

    it("should respect cwd configuration", async () => {
      execTool.configure({
        cwd: "/tmp",
      });

      const result = await execTool.execute({ command: "pwd" });
      // On macOS, /tmp is a symlink to /private/tmp
      expect(result.trim()).toMatch(/^(\/tmp|\/private\/tmp)$/);
    });

    it("should use default timeout when not specified", async () => {
      execTool.configure({});

      // Should complete quickly without hitting default 30s timeout
      const result = await execTool.execute({ command: "echo test" });
      expect(result).toBe("test\n");
    });
  });
});
