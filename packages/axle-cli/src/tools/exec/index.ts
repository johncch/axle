import * as z from "zod";
import type { ExecutableTool, ToolContext } from "../types.js";
import { formatExecError, formatOutput, runCommand } from "./helpers.js";

const execSchema = z.object({
  command: z.string().describe("The shell command to execute"),
});

export class ExecTool implements ExecutableTool<typeof execSchema> {
  name = "exec";
  description = "Execute a shell command and return the output.";
  schema = execSchema;

  private timeout: number;
  private maxBuffer: number;
  private cwd?: string;

  constructor(options?: { timeout?: number; maxBuffer?: number; cwd?: string }) {
    this.timeout = options?.timeout ?? 30000;
    this.maxBuffer = options?.maxBuffer ?? 1024 * 1024;
    this.cwd = options?.cwd;
  }

  summarize(params: z.infer<typeof execSchema>): string {
    return params.command;
  }

  async execute(params: z.infer<typeof execSchema>, ctx: ToolContext): Promise<string> {
    const { command } = params;

    try {
      const result = await runCommand(command, {
        timeout: this.timeout,
        maxBuffer: this.maxBuffer,
        cwd: this.cwd,
        signal: ctx.signal,
        onChunk: (chunk) => ctx.emit(chunk),
      });

      return formatOutput(result.stdout, result.stderr);
    } catch (error) {
      return formatExecError(error);
    }
  }
}

const execTool = new ExecTool();
export default execTool;
