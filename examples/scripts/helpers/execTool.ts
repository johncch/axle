import type { ExecutableTool } from "@fifthrevision/axle";
import { spawn } from "node:child_process";
import { z } from "zod";

const execSchema = z.object({
  command: z.string().describe("The shell command to execute"),
});

/**
 * Local example tool that streams stdout/stderr chunks through tool progress
 * events while returning the final combined output.
 */
export const execTool: ExecutableTool<typeof execSchema> = {
  name: "exec",
  description: "Execute a shell command and return stdout/stderr.",
  schema: execSchema,
  summarize: ({ command }) => command,
  async execute({ command }, ctx) {
    return new Promise((resolve) => {
      const child = spawn(command, [], { shell: true });
      let output = "";

      child.stdout?.setEncoding("utf-8");
      child.stderr?.setEncoding("utf-8");
      child.stdout?.on("data", (chunk: string) => {
        output += chunk;
        ctx.emit(chunk);
      });
      child.stderr?.on("data", (chunk: string) => {
        output += chunk;
        ctx.emit(chunk);
      });
      child.on("close", (code) => {
        resolve(code === 0 ? output : `Command exited with code ${code}\n${output}`);
      });
    });
  },
};
