import { exec } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { ExecutableContext } from "../types.js";
import { ToolExecutable } from "./types.js";

const execAsync = promisify(exec);

const execSchema = z.object({
  command: z.string().describe("The command to execute"),
  args: z
    .array(z.string())
    .optional()
    .describe("Optional arguments for the command"),
  cwd: z
    .string()
    .optional()
    .describe("Working directory for command execution"),
  timeout: z
    .number()
    .optional()
    .describe("Timeout in milliseconds (default: 30000)"),
});

const execTool: ToolExecutable<typeof execSchema> = {
  name: "exec",
  description: "Execute a command line command and return its output",
  schema: execSchema,
  execute: async (
    { command, args, cwd, timeout = 30000 },
    context: ExecutableContext,
  ) => {
    const fullCommand = args ? `${command} ${args.join(" ")}` : command;

    try {
      const { stdout, stderr } = await execAsync(fullCommand, {
        cwd,
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      const output = [];
      if (stdout) {
        output.push(`STDOUT:\n${stdout.trim()}`);
      }
      if (stderr) {
        output.push(`STDERR:\n${stderr.trim()}`);
      }

      return output.length > 0 ? output.join("\n\n") : "Command completed with no output";
    } catch (error) {
      if (error instanceof Error) {
        const execError = error as any;
        const errorOutput = [];

        errorOutput.push(`Error executing command: ${fullCommand}`);
        errorOutput.push(`Message: ${error.message}`);

        if (execError.stdout) {
          errorOutput.push(`STDOUT:\n${execError.stdout.trim()}`);
        }
        if (execError.stderr) {
          errorOutput.push(`STDERR:\n${execError.stderr.trim()}`);
        }

        throw new Error(errorOutput.join("\n"));
      }
      throw error;
    }
  },
};

export default execTool;
