import { beforeEach, describe, expect, it } from "vitest";
import execTool from "../../../src/tools/exec/index.js";
import { ToolRegistry } from "../../../src/tools/registry.js";

const ctx = {
  signal: new AbortController().signal,
  registry: new ToolRegistry(),
  emit: () => {},
};

describe("ExecTool", () => {
  beforeEach(() => {
    // Reset the tool state before each test
    execTool.configure({});
  });

  describe("command execution", () => {
    it("should return stdout from successful command", async () => {
      const result = await execTool.execute({ command: "echo hello" }, ctx);
      expect(result).toBe("hello\n");
    });

    it("should include stderr when present", async () => {
      const result = await execTool.execute(
        {
          command: 'sh -c "echo error >&2"',
        },
        ctx,
      );
      expect(result).toContain("error");
    });

    it("should handle commands that fail", async () => {
      const result = await execTool.execute({ command: "false" }, ctx);
      expect(result).toContain("Error");
    });

    it("should handle commands that don't exist", async () => {
      const result = await execTool.execute({ command: "nonexistent-command-xyz" }, ctx);
      expect(result).toContain("Error");
    });
  });

  describe("configuration options", () => {
    it("should respect timeout configuration", async () => {
      execTool.configure({
        timeout: 100, // 100ms timeout
      });

      const result = await execTool.execute({ command: "sleep 5" }, ctx);
      expect(result).toContain("Error");
    });

    it("should respect cwd configuration", async () => {
      execTool.configure({
        cwd: "/tmp",
      });

      const result = await execTool.execute({ command: "pwd" }, ctx);
      // On macOS, /tmp is a symlink to /private/tmp
      expect(result.trim()).toMatch(/^(\/tmp|\/private\/tmp)$/);
    });

    it("should use default timeout when not specified", async () => {
      execTool.configure({});

      // Should complete quickly without hitting default 30s timeout
      const result = await execTool.execute({ command: "echo test" }, ctx);
      expect(result).toBe("test\n");
    });
  });

  describe("streaming via ctx.emit", () => {
    it("emits stdout chunks as they arrive", async () => {
      const chunks: string[] = [];
      const streamingCtx = {
        signal: new AbortController().signal,
        registry: new ToolRegistry(),
        emit: (chunk: string) => chunks.push(chunk),
      };

      const result = await execTool.execute(
        { command: 'sh -c "echo line1; echo line2"' },
        streamingCtx,
      );

      expect(result).toContain("line1");
      expect(result).toContain("line2");
      // At least one chunk should have arrived via emit. Multiple lines
      // may arrive as one chunk depending on buffering, so just check the
      // joined chunks cover the output.
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.join("")).toContain("line1");
      expect(chunks.join("")).toContain("line2");
    });

    it("aborts the subprocess when ctx.signal fires", async () => {
      const controller = new AbortController();
      const abortingCtx = {
        signal: controller.signal,
        registry: new ToolRegistry(),
        emit: () => {},
      };

      // Kick off a long-running command, abort it after 50ms.
      setTimeout(() => controller.abort(), 50);
      const result = await execTool.execute({ command: "sleep 5" }, abortingCtx);
      expect(result).toContain("Error");
      expect(result).toContain("aborted");
    });
  });
});
