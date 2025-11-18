import { describe, expect, it } from "@jest/globals";
import { ExecutableContext } from "../../src/types.js";
import execTool from "../../src/tools/exec.js";

describe("exec tool", () => {
  const mockContext: ExecutableContext = {
    variables: {},
  };

  describe("basic command execution", () => {
    it("should execute a simple command successfully", async () => {
      const result = await execTool.execute(
        { command: "echo hello world" },
        mockContext,
      );

      expect(result).toContain("STDOUT:");
      expect(result).toContain("hello world");
    });

    it("should execute a command with arguments", async () => {
      const result = await execTool.execute(
        {
          command: "echo",
          args: ["test", "arguments"],
        },
        mockContext,
      );

      expect(result).toContain("STDOUT:");
      expect(result).toContain("test arguments");
    });

    it("should handle commands with no output", async () => {
      const result = await execTool.execute(
        { command: "true" },
        mockContext,
      );

      expect(result).toBe("Command completed with no output");
    });
  });

  describe("working directory", () => {
    it("should execute command in specified working directory", async () => {
      const result = await execTool.execute(
        {
          command: "pwd",
          cwd: "/tmp",
        },
        mockContext,
      );

      expect(result).toContain("STDOUT:");
      expect(result).toContain("/tmp");
    });
  });

  describe("error handling", () => {
    it("should throw error for non-existent command", async () => {
      await expect(
        execTool.execute(
          { command: "nonexistentcommand12345" },
          mockContext,
        ),
      ).rejects.toThrow();
    });

    it("should handle command that exits with non-zero status", async () => {
      await expect(
        execTool.execute({ command: "exit 1" }, mockContext),
      ).rejects.toThrow();
    });

    it("should respect timeout", async () => {
      await expect(
        execTool.execute(
          {
            command: "sleep 5",
            timeout: 100,
          },
          mockContext,
        ),
      ).rejects.toThrow();
    }, 10000);
  });

  describe("output handling", () => {
    it("should capture both stdout and stderr", async () => {
      const result = await execTool.execute(
        {
          command: "sh -c",
          args: ['"echo output_to_stdout; echo output_to_stderr >&2"'],
        },
        mockContext,
      );

      expect(result).toContain("STDOUT:");
      expect(result).toContain("output_to_stdout");
      expect(result).toContain("STDERR:");
      expect(result).toContain("output_to_stderr");
    });
  });

  describe("tool metadata", () => {
    it("should have correct tool name", () => {
      expect(execTool.name).toBe("exec");
    });

    it("should have a description", () => {
      expect(execTool.description).toBeDefined();
      expect(typeof execTool.description).toBe("string");
    });

    it("should have a schema", () => {
      expect(execTool.schema).toBeDefined();
    });
  });
});
