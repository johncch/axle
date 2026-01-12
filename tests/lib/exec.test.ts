import { describe, expect, it } from "vitest";
import { formatExecError, formatOutput, runCommand } from "../../src/lib/exec.js";

describe("lib/exec", () => {
  describe("runCommand", () => {
    it("should execute a simple command and return stdout", async () => {
      const result = await runCommand("echo hello");
      expect(result.stdout).toBe("hello\n");
      expect(result.stderr).toBe("");
    });

    it("should capture stderr", async () => {
      const result = await runCommand('sh -c "echo error >&2"');
      expect(result.stderr).toContain("error");
    });

    it("should respect cwd option", async () => {
      const result = await runCommand("pwd", { cwd: "/tmp" });
      // On macOS, /tmp is a symlink to /private/tmp
      expect(result.stdout.trim()).toMatch(/^(\/tmp|\/private\/tmp)$/);
    });

    it("should respect timeout option", async () => {
      await expect(runCommand("sleep 5", { timeout: 100 })).rejects.toThrow();
    });

    it("should throw for failed commands", async () => {
      await expect(runCommand("exit 1")).rejects.toThrow();
    });

    it("should throw for non-existent commands", async () => {
      await expect(runCommand("nonexistent-command-xyz-123")).rejects.toThrow();
    });
  });

  describe("formatExecError", () => {
    it("should format a basic Error", () => {
      const error = new Error("Command failed");
      const result = formatExecError(error);
      expect(result).toBe("Error executing command: Command failed");
    });

    it("should include stdout from exec error", () => {
      const error = new Error("Command failed") as Error & { stdout?: string };
      error.stdout = "some output";
      const result = formatExecError(error);
      expect(result).toContain("Error executing command: Command failed");
      expect(result).toContain("[stdout]: some output");
    });

    it("should include stderr from exec error", () => {
      const error = new Error("Command failed") as Error & { stderr?: string };
      error.stderr = "error output";
      const result = formatExecError(error);
      expect(result).toContain("Error executing command: Command failed");
      expect(result).toContain("[stderr]: error output");
    });

    it("should include both stdout and stderr", () => {
      const error = new Error("Command failed") as Error & {
        stdout?: string;
        stderr?: string;
      };
      error.stdout = "standard out";
      error.stderr = "standard err";
      const result = formatExecError(error);
      expect(result).toContain("[stdout]: standard out");
      expect(result).toContain("[stderr]: standard err");
    });

    it("should handle non-Error objects", () => {
      const result = formatExecError("string error");
      expect(result).toBe("Error executing command: string error");
    });

    it("should handle null/undefined", () => {
      expect(formatExecError(null)).toBe("Error executing command: null");
      expect(formatExecError(undefined)).toBe("Error executing command: undefined");
    });
  });

  describe("formatOutput", () => {
    it("should return stdout when stderr is empty", () => {
      const result = formatOutput("hello\n", "");
      expect(result).toBe("hello\n");
    });

    it("should return stdout when stderr is only whitespace", () => {
      const result = formatOutput("hello\n", "   \n  ");
      expect(result).toBe("hello\n");
    });

    it("should include stderr when present", () => {
      const result = formatOutput("output\n", "warning\n");
      expect(result).toBe("output\n\n[stderr]: warning\n");
    });

    it("should handle empty stdout with stderr", () => {
      const result = formatOutput("", "error message");
      expect(result).toBe("\n[stderr]: error message");
    });
  });
});
