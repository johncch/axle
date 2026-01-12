import * as z from "zod";
import type { ExecProviderConfig } from "../cli/configs/schemas.js";
import { formatExecError, formatOutput, runCommand } from "../lib/exec.js";
import type { Tool } from "./types.js";

const execSchema = z.object({
  command: z.string().describe("The shell command to execute"),
});

class ExecTool implements Tool<typeof execSchema> {
  name = "exec";
  description = "Execute a shell command and return the output.";
  schema = execSchema;

  private timeout = 30000;
  private maxBuffer = 1024 * 1024;
  private cwd?: string;

  constructor(config?: ExecProviderConfig) {
    if (config) {
      this.configure(config);
    }
  }

  configure(config: ExecProviderConfig) {
    this.timeout = config.timeout ?? 30000;
    this.maxBuffer = config.maxBuffer ?? 1024 * 1024;
    this.cwd = config.cwd;
  }

  async execute(params: z.infer<typeof execSchema>): Promise<string> {
    const { command } = params;

    try {
      const result = await runCommand(command, {
        timeout: this.timeout,
        maxBuffer: this.maxBuffer,
        cwd: this.cwd,
      });

      return formatOutput(result.stdout, result.stderr);
    } catch (error) {
      return formatExecError(error);
    }
  }
}

const execTool = new ExecTool();
export default execTool;
